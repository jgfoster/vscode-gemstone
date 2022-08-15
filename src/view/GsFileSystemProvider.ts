/*---------------------------------------------------------------------------------------------
 *  based on
 *https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
 *--------------------------------------------------------------------------------------------*/

import { type } from 'os';
import * as vscode from 'vscode';

import { GsClassFile, GsFile } from '../model/GsClassFile';
import { GsDictionaryFile } from '../model/GsDictionaryFile';
import { Session } from '../model/Session';
import { SymbolDictionary } from '../model/SymbolDictionary';

function str2ab(str: string): Uint8Array {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
}

export class GsFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _session: Session;
  public readonly map: Map<string, GsFile> = new Map();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  private constructor(session: Session) {
    this._session = session;
  }

  createDirectory(uri: vscode.Uri): void {
    console.log(`GemStoneFS.createDirectory(${uri.toString()})`);
  }

  delete(uri: vscode.Uri): void {
    console.log('GemStoneFS.delete(' + uri.toString() + ')');
  }

  static async forSession(session: Session): Promise<GsFileSystemProvider> {
    return new Promise(async (resolve, reject) => {
      const fs = new GsFileSystemProvider(session);

      // obtain list of SymbolDictionary instances
      try {
        const symbolList: Array<SymbolDictionary> = await session.getSymbolList();
        const list: { 'uri': vscode.Uri, 'name': string }[] = symbolList.map((aSymbolDictionary: SymbolDictionary) => {
          const uri: vscode.Uri = vscode.Uri.parse(session.fsScheme() + ':/' + aSymbolDictionary.name);
          const gsDictionaryFile: GsDictionaryFile = new GsDictionaryFile(session, aSymbolDictionary);
          fs.map.set(uri.toString(), gsDictionaryFile);
          return { 'uri': uri, 'name': uri.toString() };
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

  // https://github.com/microsoft/vscode/issues/157859
  async readDirectory(dictionaryUri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    return new Promise(async (resolve, reject) => {
      const result: [string, vscode.FileType][] = [];
      try {
        const aGsDictionaryFile: GsDictionaryFile = this.map.get(dictionaryUri.toString())! as GsDictionaryFile;
        const myString = await this._session.stringFromPerform('getClassesInDictionary:', [aGsDictionaryFile.oop], 65535);
        console.log(`myString.length = ${myString.length}`);
        JSON.parse(myString).list.forEach((eachClass: { oop: number, name: string, size: number, md5: string }) => {
          const newUri = vscode.Uri.parse(dictionaryUri.toString() + '/' + eachClass.name);
          const newEntry: GsClassFile = aGsDictionaryFile.addEntry(this._session, eachClass);
          this.map.set(newUri.toString(), newEntry);
          result.push([eachClass.name, newEntry.type]);
        });
        resolve(result);
      } catch (e: any) {
        reject(e);
      }
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.toString().includes('.vscode')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return new Promise(async (resolve, reject) => {
      const entry: GsFile = this.map.get(uri.toString())!;
      if (!entry) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      try {
        let result = await this._session.stringFromPerform('fileOutClass:', [entry.oop], entry.size + 32);
        resolve(str2ab(result));
      } catch (e: any) {
        reject(e);
      }
    });
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }):
    void {
    console.log(
      'GemStoneFS.rename(' + oldUri.toString() + ', ' + newUri.toString() +
      ')');
  }

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
    const entry: vscode.FileStat = this.map.get(uri.toString())!;
    if (!entry) {
      console.error('stat(\'' + uri.toString() + '\') entry not found!');
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  uint8ArrayToExecutableString(array: Uint8Array) {
    var string = String.fromCharCode.apply(null, (array as any));
    var executableString = string.replace(RegExp(`'`, 'g'), `''`);
    return executableString;
  }

  watch(_uri: vscode.Uri, _options: {
    recursive: boolean,
    excludes: string[]
  }): vscode.Disposable {
    // It is the file system provider's job to call onDidChangeFile for every change given these rules. 
    // No event should be emitted for files that match any of the provided excludes.
    // https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider
    // console.log(`GsFileSystemProvider.watch(${uri.toString()}, {excludes: ${options['excludes']}, recursive: ${_options['recursive']}})`);
    // We should notify VS Code when the file changes (e.g., by a different session in a commit)
    return new vscode.Disposable(() => {
      // console.log(`dispose watch(${uri.toString()})`);
    });
  }

  writeFile(uri: vscode.Uri, _content: Uint8Array, _options: {
    create: boolean,
    overwrite: boolean
  }): void {
    console.log(`write(${uri}), "...", {create: ${_options.create}, overwrite: ${_options.overwrite}})`);
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
}
