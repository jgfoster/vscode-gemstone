import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

/**
 * Manages exporting GemStone classes to local .gs files in Topaz file-out format.
 *
 * Default file structure:
 *   {workspaceRoot}/.gemstone/{session}/{index}-{dictName}/{ClassName}.gs
 *
 * The `gemstone.exportPath` setting supports variables:
 *   {workspaceRoot}, {session}, {host}, {stone}, {user}, {index}, {dictName}
 * e.g. {workspaceRoot}/smalltalk/{dictName}
 */
export class ExportManager {
  // Track exported file paths per session so we can detect stale files on refresh
  private exportedFiles = new Map<number, Set<string>>();

  // Suppress file-watcher events while we are writing
  private writing = false;

  get isWriting(): boolean {
    return this.writing;
  }

  private getUserManagedDictionaries(): Set<string> {
    const list = vscode.workspace
      .getConfiguration('gemstone')
      .get<string[]>('userManagedDictionaries', []);
    return new Set(list);
  }

  /**
   * Resolved export path template for a session.
   * Uses the `gemstone.exportPath` setting with variable substitution.
   * Session-level variables are resolved; {index} and {dictName} remain as placeholders.
   */
  getResolvedTemplate(session: ActiveSession): string | undefined {
    const config = vscode.workspace.getConfiguration('gemstone');
    const custom = config.get<string>('exportPath', '').trim();
    const folders = vscode.workspace.workspaceFolders;
    const wsRoot = folders?.[0]?.uri.fsPath;
    const { gem_host, stone, gs_user } = session.login;
    const sessionId = String(session.id);

    if (custom) {
      let resolved = custom
        .replace(/\{workspaceRoot}/g, wsRoot ?? '')
        .replace(/\{session}/g, sessionId)
        .replace(/\{host}/g, gem_host)
        .replace(/\{stone}/g, stone)
        .replace(/\{user}/g, gs_user);
      // Normalize separators for current platform (e.g. forward slashes in config become backslashes on Windows)
      resolved = path.normalize(resolved);
      // Handle relative paths (substitute dict vars with dummies to test)
      const testPath = resolved.replace(/\{index}/g, '0').replace(/\{dictName}/g, 'X');
      if (!path.isAbsolute(testPath)) {
        if (!wsRoot) return undefined;
        resolved = path.resolve(wsRoot, resolved);
      }
      return resolved;
    }

    // Default: {workspaceRoot}/.gemstone/{session}/{index}-{dictName}
    if (!wsRoot) return undefined;
    return path.join(wsRoot, '.gemstone', sessionId, '{index}-{dictName}');
  }

  /**
   * Full path for a specific dictionary directory.
   */
  getDictPath(session: ActiveSession, dictIndex: number, dictName: string): string | undefined {
    const template = this.getResolvedTemplate(session);
    if (!template) return undefined;
    return template
      .replace(/\{index}/g, String(dictIndex))
      .replace(/\{dictName}/g, dictName);
  }

  /**
   * Session-specific root directory (parent of all dictionary directories).
   */
  getSessionRoot(session: ActiveSession): string | undefined {
    const template = this.getResolvedTemplate(session);
    if (!template) return undefined;
    return path.dirname(template);
  }

  /**
   * Export all classes for a session, showing progress.
   * If `silent` is true, skip quietly when there is no export destination.
   */
  async exportSession(session: ActiveSession, silent = false): Promise<void> {
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot) {
      if (!silent) {
        vscode.window.showWarningMessage(
          'No workspace folder open. Open a folder (File > Open Folder) or set `gemstone.exportPath` to enable class export.',
        );
      }
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting GemStone classes',
        cancellable: true,
      },
      async (progress, token) => {
        // 1. Get dictionary names
        const dictNames = queries.getDictionaryNames(session);
        if (token.isCancellationRequested) return;

        // 2. Gather all classes per dictionary, skipping user-managed ones
        const managed = this.getUserManagedDictionaries();
        const plan: { dictIndex: number; dictLabel: string; dirPath: string; classes: string[] }[] = [];
        let totalClasses = 0;
        for (let i = 0; i < dictNames.length; i++) {
          if (managed.has(dictNames[i])) continue;
          const dictIndex = i + 1; // Smalltalk 1-based
          const dirPath = this.getDictPath(session, dictIndex, dictNames[i])!;
          const dictLabel = path.basename(dirPath);
          const classes = queries.getClassNames(session, dictIndex);
          plan.push({ dictIndex, dictLabel, dirPath, classes });
          totalClasses += classes.length;
        }

        if (token.isCancellationRequested) return;

        // 3. Make existing files writable so we can overwrite them
        this.setPermissions(sessionRoot, 0o644, managed);

        // 4. Create all dictionary directories (even empty ones) and export classes
        const newFiles = new Set<string>();
        const currentDictDirs = new Set<string>();
        let exported = 0;

        this.writing = true;
        try {
          for (const dict of plan) {
            if (token.isCancellationRequested) break;
            fs.mkdirSync(dict.dirPath, { recursive: true });
            currentDictDirs.add(dict.dirPath);

            for (const className of dict.classes) {
              if (token.isCancellationRequested) break;

              progress.report({
                message: `${dict.dictLabel}/${className} (${exported + 1}/${totalClasses})`,
                increment: totalClasses > 0 ? (1 / totalClasses) * 100 : 0,
              });

              try {
                const source = queries.fileOutClass(session, className, dict.dictIndex);
                const filePath = path.join(dict.dirPath, `${className}.gs`);
                fs.writeFileSync(filePath, source, 'utf-8');
                newFiles.add(filePath);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                // Log but don't abort — some classes may fail (e.g., kernel classes)
                console.warn(`Export failed for ${className}: ${msg}`);
              }
              exported++;
            }
          }
        } finally {
          this.writing = false;
        }

        // 5. Mark all exported files read-only (files are for search/navigation only)
        this.setPermissions(sessionRoot, 0o444, managed);

        // 6. Remove stale files (classes that no longer exist)
        const previousFiles = this.exportedFiles.get(session.id);
        if (previousFiles) {
          for (const oldFile of previousFiles) {
            if (!newFiles.has(oldFile) && fs.existsSync(oldFile)) {
              try {
                fs.chmodSync(oldFile, 0o644);
                fs.unlinkSync(oldFile);
              } catch { /* ignore */ }
            }
          }
        }

        // 7. Remove stale dictionary directories (dictionaries that no longer exist)
        this.removeStaleDictDirs(sessionRoot, currentDictDirs, managed);

        // 8. Track exported files
        this.exportedFiles.set(session.id, newFiles);

        vscode.window.showInformationMessage(
          `Exported ${exported} classes from ${dictNames.length} dictionaries.`,
        );
      },
    );
  }

  /**
   * Re-export all classes (e.g., after commit or abort).
   */
  async refreshSession(session: ActiveSession): Promise<void> {
    return this.exportSession(session, true);
  }

  /**
   * Delete all exported files and the session directory on logout.
   */
  deleteSessionFiles(session: ActiveSession): void {
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot || !fs.existsSync(sessionRoot)) return;

    this.writing = true;
    try {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    } finally {
      this.writing = false;
    }

    this.exportedFiles.delete(session.id);

    // Remove parent directory if empty (e.g., the '.gemstone' dir)
    const parent = path.dirname(sessionRoot);
    try {
      const remaining = fs.readdirSync(parent);
      if (remaining.length === 0) {
        fs.rmdirSync(parent);
      }
    } catch { /* ignore */ }
  }

  /**
   * Recursively set file permissions on all .gs files under a directory.
   * Skips user-managed dictionary directories at the top level.
   */
  private setPermissions(dir: string, mode: number, managed?: Set<string>): void {
    if (!fs.existsSync(dir)) return;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return;

    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const entryStat = fs.statSync(full);
      if (entryStat.isDirectory()) {
        // Skip user-managed dictionary directories
        if (managed) {
          const dictMatch = entry.match(/^\d+-(.*)/);
          const dictName = dictMatch ? dictMatch[1] : entry;
          if (managed.has(dictName)) continue;
        }
        this.setPermissions(full, mode);
      } else if (entry.endsWith('.gs')) {
        try {
          fs.chmodSync(full, mode);
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Remove dictionary directories under sessionRoot that are not in the current set.
   * Preserves user-managed dictionary directories.
   */
  private removeStaleDictDirs(sessionRoot: string, currentDirs: Set<string>, managed?: Set<string>): void {
    if (!fs.existsSync(sessionRoot)) return;
    for (const entry of fs.readdirSync(sessionRoot)) {
      const full = path.join(sessionRoot, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      if (currentDirs.has(full)) continue;

      // Preserve user-managed dictionary directories
      if (managed) {
        const dictMatch = entry.match(/^\d+-(.*)/);
        const dictName = dictMatch ? dictMatch[1] : entry;
        if (managed.has(dictName)) continue;
      }

      try {
        fs.rmSync(full, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  dispose(): void {
    this.exportedFiles.clear();
  }
}
