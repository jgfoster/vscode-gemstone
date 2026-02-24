import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

/**
 * Manages exporting GemStone classes to local .gs files in Topaz file-out format.
 *
 * File structure:
 *   {workspaceRoot}/gemstone/{gem_host}/{stone}/{gs_user}/{N. DictName}/{ClassName}.gs
 */
export class ExportManager {
  // Track exported file paths per session so we can detect stale files on refresh
  private exportedFiles = new Map<number, Set<string>>();

  // Suppress file-watcher events while we are writing
  private writing = false;

  get isWriting(): boolean {
    return this.writing;
  }

  /**
   * Root directory for exports. Uses the `gemstone.exportPath` setting if set,
   * otherwise defaults to {firstWorkspaceFolder}/gemstone.
   */
  getExportRoot(): string | undefined {
    const config = vscode.workspace.getConfiguration('gemstone');
    const custom = config.get<string>('exportPath', '').trim();
    if (custom) return custom;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return path.join(folders[0].uri.fsPath, 'gemstone');
  }

  /**
   * Session-specific directory: {exportRoot}/{host}/{stone}/{user}
   */
  getSessionRoot(session: ActiveSession): string | undefined {
    const root = this.getExportRoot();
    if (!root) return undefined;
    const { gem_host, stone, gs_user } = session.login;
    return path.join(root, gem_host, stone, gs_user);
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

        // 2. Gather all classes per dictionary
        const plan: { dictIndex: number; dictLabel: string; dirPath: string; classes: string[] }[] = [];
        let totalClasses = 0;
        for (let i = 0; i < dictNames.length; i++) {
          const dictIndex = i + 1; // Smalltalk 1-based
          const dictLabel = `${dictIndex}. ${dictNames[i]}`;
          const dirPath = path.join(sessionRoot, dictLabel);
          const classes = queries.getClassNames(session, dictIndex);
          plan.push({ dictIndex, dictLabel, dirPath, classes });
          totalClasses += classes.length;
        }

        if (token.isCancellationRequested) return;

        // 3. Make existing files writable so we can overwrite them
        this.setPermissions(sessionRoot, 0o644);

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
                const source = queries.fileOutClass(session, dict.dictIndex, className);
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

        // 5. Remove stale files (classes that no longer exist)
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

        // 6. Remove stale dictionary directories (dictionaries that no longer exist)
        this.removeStaleDictDirs(sessionRoot, currentDictDirs);

        // 7. Track exported files
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
   * Mark all exported files as read-only (on logout).
   */
  markReadOnly(session: ActiveSession): void {
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot || !fs.existsSync(sessionRoot)) return;
    this.setPermissions(sessionRoot, 0o444);
  }

  /**
   * Mark all exported files as writable (before re-export).
   */
  markWritable(session: ActiveSession): void {
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot || !fs.existsSync(sessionRoot)) return;
    this.setPermissions(sessionRoot, 0o644);
  }

  /**
   * Recursively set file permissions on all .gs files under a directory.
   */
  private setPermissions(dir: string, mode: number): void {
    if (!fs.existsSync(dir)) return;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return;

    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const entryStat = fs.statSync(full);
      if (entryStat.isDirectory()) {
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
   * This handles renamed or removed dictionaries without touching valid empty ones.
   */
  private removeStaleDictDirs(sessionRoot: string, currentDirs: Set<string>): void {
    if (!fs.existsSync(sessionRoot)) return;
    for (const entry of fs.readdirSync(sessionRoot)) {
      const full = path.join(sessionRoot, entry);
      if (fs.statSync(full).isDirectory() && !currentDirs.has(full)) {
        try {
          fs.rmSync(full, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    }
  }

  dispose(): void {
    this.exportedFiles.clear();
  }
}
