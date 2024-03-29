import * as vscode from 'vscode';
import * as path from 'path';

export class SymbolDictionary extends vscode.TreeItem {
  constructor(
    public readonly oop: number,
    public readonly name: string,
    public readonly size: number
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = this.label;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'namespace.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'namespace.svg')
  };
}
