import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import { ExportManager } from './exportManager';
import { fileInClass } from './topazFileIn';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';

// ── Content Provider ────────────────────────────────────────

export class ReconcileContentProvider implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();

  setContent(key: string, content: string): vscode.Uri {
    this.contents.set(key, content);
    return vscode.Uri.parse(`gemstone-reconcile://compare/${encodeURIComponent(key)}`);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = decodeURIComponent(uri.path.slice(1)); // strip leading /
    return this.contents.get(key) ?? '';
  }

  clear(): void {
    this.contents.clear();
  }
}

// ── Types ───────────────────────────────────────────────────

export interface FileDiff {
  localPath: string;
  dictIndex: number;
  dictLabel: string;
  className: string;
  localContent: string;
  gemstoneContent: string;
}

interface CompareResult {
  diffs: FileDiff[];
  localOnlyCount: number;
}

// ── ReconcileManager ────────────────────────────────────────

export class ReconcileManager {
  private contentProvider = new ReconcileContentProvider();
  private disposables: vscode.Disposable[] = [];

  constructor(private exportManager: ExportManager) {}

  register(context: vscode.ExtensionContext): void {
    const sub = vscode.workspace.registerTextDocumentContentProvider(
      'gemstone-reconcile',
      this.contentProvider,
    );
    this.disposables.push(sub);
    context.subscriptions.push(sub);
  }

  /**
   * On login: check for existing .gs files. If found, compare against GemStone
   * and let the user decide. Otherwise, do a normal export.
   */
  async reconcileOrExport(session: ActiveSession, silent = false): Promise<void> {
    const sessionRoot = this.exportManager.getSessionRoot(session);
    if (!sessionRoot || !this.hasExistingFiles(sessionRoot)) {
      return this.exportManager.exportSession(session, silent);
    }

    let compareResult: CompareResult | undefined;

    try {
      compareResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Comparing local files with GemStone',
          cancellable: true,
        },
        (progress, token) => this.compareFiles(session, sessionRoot, progress, token),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Reconciliation failed: ${msg}`);
      return; // Skip — leave both sides as-is
    }

    if (!compareResult || compareResult.diffs.length === 0) {
      // No differences — proceed with normal export
      return this.exportManager.exportSession(session, silent);
    }

    const choice = await this.showSummaryDialog(
      compareResult.diffs.length,
      compareResult.localOnlyCount,
    );

    switch (choice) {
      case 'Use GemStone':
        return this.exportManager.exportSession(session, silent);
      case 'Use Local':
        return this.useLocal(session, compareResult.diffs, silent);
      case 'Show Differences':
        return this.showDifferencesPanel(session, compareResult.diffs, silent);
      case 'Skip':
      default:
        // Do nothing — leave both sides as-is
        break;
    }
  }

  private hasExistingFiles(sessionRoot: string): boolean {
    if (!fs.existsSync(sessionRoot)) return false;
    for (const entry of fs.readdirSync(sessionRoot)) {
      const dirPath = path.join(sessionRoot, entry);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      for (const file of fs.readdirSync(dirPath)) {
        if (file.endsWith('.gs')) return true;
      }
    }
    return false;
  }

  private async compareFiles(
    session: ActiveSession,
    sessionRoot: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<CompareResult> {
    const diffs: FileDiff[] = [];
    let localOnlyCount = 0;

    // Scan local directories for numbered dict dirs and .gs files
    const localEntries: { dictIndex: number; dictLabel: string; dirPath: string; classes: string[] }[] = [];
    let totalFiles = 0;

    for (const entry of fs.readdirSync(sessionRoot)) {
      const dirPath = path.join(sessionRoot, entry);
      if (!fs.statSync(dirPath).isDirectory()) continue;

      const indexMatch = entry.match(/^(\d+)\.\s/);
      if (!indexMatch) continue;

      const dictIndex = parseInt(indexMatch[1], 10);
      const classes: string[] = [];

      for (const file of fs.readdirSync(dirPath)) {
        if (file.endsWith('.gs')) {
          classes.push(file.slice(0, -3)); // strip .gs
        }
      }

      localEntries.push({ dictIndex, dictLabel: entry, dirPath, classes });
      totalFiles += classes.length;
    }

    if (token.isCancellationRequested) return { diffs, localOnlyCount };

    // Compare each local file against GemStone
    let compared = 0;
    for (const dict of localEntries) {
      if (token.isCancellationRequested) break;

      for (const className of dict.classes) {
        if (token.isCancellationRequested) break;

        progress.report({
          message: `${dict.dictLabel}/${className} (${compared + 1}/${totalFiles})`,
          increment: totalFiles > 0 ? (1 / totalFiles) * 100 : 0,
        });

        const localPath = path.join(dict.dirPath, `${className}.gs`);
        const localContent = fs.readFileSync(localPath, 'utf-8');

        let gemstoneContent: string;
        try {
          gemstoneContent = queries.fileOutClass(session, dict.dictIndex, className);
        } catch {
          // Class no longer at this index in GemStone
          localOnlyCount++;
          compared++;
          continue;
        }

        if (localContent !== gemstoneContent) {
          diffs.push({
            localPath,
            dictIndex: dict.dictIndex,
            dictLabel: dict.dictLabel,
            className,
            localContent,
            gemstoneContent,
          });
        }

        compared++;
      }
    }

    return { diffs, localOnlyCount };
  }

  private async showSummaryDialog(
    diffCount: number,
    localOnlyCount: number,
  ): Promise<string | undefined> {
    let message = `${diffCount} file${diffCount === 1 ? '' : 's'} differ between local and GemStone.`;
    if (localOnlyCount > 0) {
      message += ` ${localOnlyCount} local file${localOnlyCount === 1 ? '' : 's'} not found in GemStone.`;
    }

    return vscode.window.showInformationMessage(
      message,
      'Use GemStone',
      'Use Local',
      'Show Differences',
      'Skip',
    );
  }

  private async useLocal(
    session: ActiveSession,
    diffs: FileDiff[],
    silent: boolean,
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Filing in local changes',
        cancellable: true,
      },
      async (progress, token) => {
        let filed = 0;
        const errors: string[] = [];

        for (const diff of diffs) {
          if (token.isCancellationRequested) break;

          progress.report({
            message: `${diff.className} (${filed + 1}/${diffs.length})`,
            increment: (1 / diffs.length) * 100,
          });

          const result = fileInClass(session, diff.localContent);
          if (!result.success) {
            errors.push(
              `${diff.className}: ${result.errors.map((e) => e.message).join('; ')}`,
            );
          }
          filed++;
        }

        if (errors.length > 0) {
          vscode.window.showWarningMessage(
            `Filed in ${filed - errors.length}/${diffs.length} classes. ${errors.length} failed.`,
          );
        }
      },
    );

    // After filing in, run normal export to sync everything
    await this.exportManager.exportSession(session, silent);
  }

  private async showDifferencesPanel(
    session: ActiveSession,
    diffs: FileDiff[],
    silent: boolean,
  ): Promise<void> {
    const items = diffs.map((d) => ({
      label: d.className,
      description: d.dictLabel,
      detail: d.localPath,
      diff: d,
    }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `${diffs.length} changed file${diffs.length === 1 ? '' : 's'}. Select to view diff, or press Escape to choose action.`,
    });

    if (pick) {
      await this.showFileDiff(pick.diff);
      // After viewing a diff, re-show the list
      return this.showDifferencesPanel(session, diffs, silent);
    }

    // User pressed Escape — show batch action dialog
    return this.showBatchActionDialog(session, diffs, silent);
  }

  private async showFileDiff(diff: FileDiff): Promise<void> {
    const localUri = vscode.Uri.file(diff.localPath);
    const gsUri = this.contentProvider.setContent(
      `${diff.dictLabel}/${diff.className}`,
      diff.gemstoneContent,
    );

    await vscode.commands.executeCommand(
      'vscode.diff',
      gsUri,
      localUri,
      `${diff.className} (GemStone ↔ Local)`,
    );
  }

  private async showBatchActionDialog(
    session: ActiveSession,
    diffs: FileDiff[],
    silent: boolean,
  ): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `${diffs.length} file${diffs.length === 1 ? '' : 's'} differ. Choose action for all:`,
      'Use GemStone',
      'Use Local',
      'Skip',
    );

    switch (choice) {
      case 'Use GemStone':
        return this.exportManager.exportSession(session, silent);
      case 'Use Local':
        return this.useLocal(session, diffs, silent);
      case 'Skip':
      default:
        break;
    }
  }

  dispose(): void {
    this.contentProvider.clear();
    for (const d of this.disposables) d.dispose();
  }
}
