import * as vscode from 'vscode';
import * as path from 'path';

export class SymbolDictionary  {
  constructor(
    public readonly oop: number,
    public readonly name: string,
    public readonly size: number
  ) {
  }
}
