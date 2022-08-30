import * as vscode from 'vscode';

export class MyFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  constructor() { }
  watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    throw new Error('Method not implemented.');
  }
  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }

  createDirectory(uri: vscode.Uri): void {
    throw new Error('Method not implemented.');
  }

  delete(uri: vscode.Uri): void {
    throw new Error('Method not implemented.');
  }

  async readDirectory(parentUri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log(parentUri.toString());
    const list: [string, vscode.FileType][] = [];
    for (const each of 'abcdefghijklmnopqrstuvwxyz') {
      list.push([each, vscode.FileType.File]);
    }
    return list;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return new Uint8Array();
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }):
    void {
    throw new Error('Method not implemented.');
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    throw vscode.FileSystemError.FileNotFound(uri);
  }
}
