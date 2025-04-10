import * as vscode from 'vscode';
import * as path from 'path';

export class SymbolDictionary extends vscode.TreeItem {
  constructor(
    public readonly oop: number,
    public readonly name: string,
    public readonly size: number
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
  }
}
