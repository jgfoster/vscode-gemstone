import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import { loginLabel } from './loginTypes';

export class GemStoneSessionItem extends vscode.TreeItem {
  constructor(public readonly activeSession: ActiveSession, isSelected: boolean) {
    super(loginLabel(activeSession.login), vscode.TreeItemCollapsibleState.None);
    const { id, stoneVersion } = activeSession;
    this.description = `Session ${id} (${stoneVersion})`;
    this.tooltip = `Session ${id}: ${loginLabel(activeSession.login)} (${stoneVersion})`;
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
