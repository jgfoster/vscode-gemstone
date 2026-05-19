import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';

// ── ClassBrowser panel ─────────────────────────────────────

/**
 * Opens class definitions as regular gemstone:// documents in the editor.
 * 
 * Class-definition tabs are closed automatically when the session logs out
 * via GemStoneFileSystemProvider.closeTabsForSession in the extension logout flow,
 * so no explicit cleanup is needed in disposeForSession.
 */
export class ClassBrowser {
  static async showOrUpdate(
    session: ActiveSession,
    dictionaries: string[],
    dictIndex: number,
    className: string | null,
  ): Promise<void> {
    if (!className) return;

    const dictName = dictionaries[dictIndex - 1];
    if (!dictName) return;

    const uri = vscode.Uri.parse(
      `gemstone://${session.id}/${encodeURIComponent(dictName)}/${encodeURIComponent(className)}/definition`,
    );

    // Don't re-fetch and re-open if the tab is already present anywhere
    const uriString = uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri?.toString() === uriString) return;
      }
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Two,
      preview: true,
      preserveFocus: true,
    });
  }
}
