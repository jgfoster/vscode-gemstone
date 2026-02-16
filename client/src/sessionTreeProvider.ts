import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';

export class GemStoneSessionItem extends vscode.TreeItem {
  constructor(public readonly activeSession: ActiveSession, isSelected: boolean) {
    super(activeSession.login.label, vscode.TreeItemCollapsibleState.None);
    const { id, login, stoneVersion } = activeSession;
    this.description = `${id}: ${login.gs_user} in ${login.stone} (${stoneVersion}) on ${login.gem_host}`;
    this.tooltip = `${id}: ${login.gs_user} in ${login.stone} (${stoneVersion}) on ${login.gem_host}`;
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'debug-start' : 'plug');
    this.contextValue = 'gemstoneSession';
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<GemStoneSessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GemStoneSessionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private sessionManager: SessionManager) {
    sessionManager.onDidChangeSelection(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: GemStoneSessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): GemStoneSessionItem[] {
    const selectedId = this.sessionManager.selectedId;
    return this.sessionManager.getSessions().map(
      (s) => new GemStoneSessionItem(s, s.id === selectedId)
    );
  }
}
