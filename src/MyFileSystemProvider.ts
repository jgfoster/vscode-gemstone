import * as vscode from 'vscode';

export class MyFileStat implements vscode.FileStat {
  type: vscode.FileType = vscode.FileType.Directory;
  ctime: number = 0;
  mtime: number = 0;
  size: number = 26;
}

export class MyFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  createDirectory(uri: vscode.Uri): void {
    throw new Error('Method not implemented.');
  }

  delete(uri: vscode.Uri): void {
    throw new Error('Method not implemented.');
  }

  async readDirectory(parentUri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    console.log('readDirectory', parentUri.toString());
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
    if (uri.toString() === 'scheme:/root') {
      console.log('found scheme:/root');
      return new MyFileStat;
    }
    if (uri.toString().startsWith('scheme:/root/.vscode/')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    console.log('stat', uri.toString(), 'FileNotFound!');
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    // console.log('watch', uri.toString());
    throw new Error('Method not implemented.');
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }
}
