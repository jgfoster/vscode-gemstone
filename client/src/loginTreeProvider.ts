import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel } from './loginTypes';
import { LoginStorage } from './loginStorage';

export class GemStoneLoginItem extends vscode.TreeItem {
  constructor(public readonly login: GemStoneLogin) {
    super(loginLabel(login), vscode.TreeItemCollapsibleState.None);
    this.description = login.version || '';
    this.tooltip = `${loginLabel(login)} (${login.version || ''})`;
    this.iconPath = new vscode.ThemeIcon('server');
    this.contextValue = 'gemstoneLogin';
    this.command = {
      command: 'gemstone.editLogin',
      title: 'Edit Login',
      arguments: [this],
    };
  }
}

export class LoginTreeProvider implements vscode.TreeDataProvider<GemStoneLoginItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GemStoneLoginItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private storage: LoginStorage) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: GemStoneLoginItem): vscode.TreeItem {
    return element;
  }

  getChildren(): GemStoneLoginItem[] {
    return this.storage.getLogins().map((l) => new GemStoneLoginItem(l));
  }
}
