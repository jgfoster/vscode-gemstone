import * as vscode from 'vscode';
import { GemStoneLogin } from './loginTypes';
import { LoginStorage } from './loginStorage';

export class GemStoneLoginItem extends vscode.TreeItem {
  constructor(public readonly login: GemStoneLogin) {
    super(login.label, vscode.TreeItemCollapsibleState.None);
    this.description = `${login.gs_user || ''}@${login.gem_host || ''}`;
    this.tooltip = `${login.gs_user || ''}@${login.gem_host || ''}:${login.stone || ''} (${login.version || ''})`;
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
