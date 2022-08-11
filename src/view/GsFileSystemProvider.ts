/*---------------------------------------------------------------------------------------------
 *  based on
 *https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { GsFile } from '../model/GsClassFile';
import { GsDictionaryFile } from '../model/GsDictionaryFile';
import { Session } from '../model/Session';

function str2ab(str: string): Uint8Array {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
}

export class GsFileSystemProvider implements vscode.FileSystemProvider {
  private session: Session;
  public readonly map: Map<string, any> = new Map();

  private constructor(session: Session) {
    this.session = session;
  }

  static async forSession(session: Session): Promise<GsFileSystemProvider> {
    return new Promise(async (resolve, reject) => {
      const fs = new GsFileSystemProvider(session);

      // obtain list of SymbolDictionary instances
      try {
        const symbolList = await session.getSymbolList();
        const list = symbolList.map((each: any) => {
          const uri = vscode.Uri.parse(session.fsScheme() + ':/' + each.name);
          const dict = new GsDictionaryFile(session, each.name, each);
          fs.map.set(uri.toString(), dict);
          return { 'uri': uri, 'name': each.name };
        });
        const workspaceFolders = vscode.workspace.workspaceFolders;
        //   If the first workspace folder is added, removed or changed, the currently executing extensions 
        //    (including the one that called this method) will be terminated and restarted so that the (deprecated) 
        //    rootPath property is updated to point to the first workspace folder.
        //   See isValidSetup() where we ensure that a first folder exists.
        //   Use the onDidChangeWorkspaceFolders() event to get notified when the workspace folders have been updated.
        const flag = vscode.workspace.updateWorkspaceFolders(
          workspaceFolders ? workspaceFolders.length : 0, null, ...list);
        if (flag) {
          resolve(fs);
        } else {
          reject({ 'message': 'Unable to create workspace folder!' });
        }
      } catch (ex: any) {
        reject(ex);
      }
    });
  }

  // --- manage file metadata

  // return a FileStat-type
  //    (ctime: number, mtime: number, size: number, type: FileType)
  // VS Code looks for the following in each directory:
  //    .vscode/settings.json
  //    .vscode/tasks.json
  //    .vscode/launch.json
  stat(uri: vscode.Uri): vscode.FileStat {
    if (uri.toString().includes('.vscode')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (uri.toString().includes('.git')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const entry: vscode.FileStat = this.map.get(uri.toString());
    if (!entry) {
      console.error('stat(\'' + uri.toString() + '\') entry not found!');
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  // https://github.com/microsoft/vscode/issues/157859
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    return new Promise(async (resolve, reject) => {
      const result: [string, vscode.FileType][] = new Array;
      try {
        const dict = this.map.get(uri.toString());
        const myString = await this.session.stringFromPerform(
          'getClassesInDictionary:', [dict.oop], 65525);
        JSON.parse(myString).list.forEach((element: any) => {
          const newUri = vscode.Uri.parse(uri.toString() + '/' + element.key);
          const newEntry = dict.addEntry(this.session, element.key, element);
          this.map.set(newUri.toString(), newEntry);
          result.push([element.key, newEntry.type]);
        });
        resolve(result);
      } catch (e: any) {
        reject(e);
      }
    });
  }

  // --- manage file contents

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.toString().includes('.vscode')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return new Promise(async (resolve, reject) => {
      const entry: GsFile = this.map.get(uri.toString());
      if (!entry) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      try {
        let result = await this.session.stringFromPerform('fileOutClass:', [entry.oop], entry.size + 32);
        resolve(str2ab(result));
      } catch (e: any) {
        reject(e);
      }
    });
  }

  uint8ArrayToExecutableString(array: Uint8Array) {
    var string = String.fromCharCode.apply(null, (array as any));
    var executableString = string.replace(RegExp(`'`, 'g'), `''`);
    return executableString;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, options: {
    create: boolean,
    overwrite: boolean
  }): void {
    // const entry: any = this.map.get(uri.toString());
    // try {
    //   var executeString: string = `${entry.gsClass} compileMethod: '${this.uint8ArrayToExecutableString(content)}'`;
    //   console.log(`GemStoneFS.writeFile(${uri.toString()}, ${options.create}, ${options.overwrite})`);
    //   console.log('content: ', executeString);
    //   this.session.oopFromExecuteString(executeString);
    //   this.session.commit();
    // } catch (e) {
    //   console.log('ERROR', e);
    // }
  }

  // --- manage files/folders

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }):
    void {
    console.log(
      'GemStoneFS.rename(' + oldUri.toString() + ', ' + newUri.toString() +
      ')');
  }

  delete(uri: vscode.Uri): void {
    console.log('GemStoneFS.delete(' + uri.toString() + ')');
  }

  createDirectory(uri: vscode.Uri): void {
    console.log(`GemStoneFS.createDirectory(${uri.toString()})`);
  }

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // console.log(`GsFileSystemProvider.watch()`, _resource.toString());
    // ignore, fires for all changes...
    return new vscode.Disposable(() => { });
  }
}
