/*---------------------------------------------------------------------------------------------
 *  based on
 *https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { GsClassFile, GsDictionaryFile, GsFile, GsSessionFile } from '../model/GsFile';
import { Session } from '../model/Session';
import { SymbolDictionary } from '../model/SymbolDictionary';

export class GsFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _session: Session;
  public readonly entries: Map<string, GsFile> = new Map();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  str2ab(str: string): Uint8Array {
    var buf = new ArrayBuffer(str.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0, strLen = str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return bufView;
  }

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
      const instance = new GsFileSystemProvider(session);

      // obtain list of SymbolDictionary instances
      try {
        const symbolList: Array<SymbolDictionary> = await session.getSymbolList();
        const root = new GsSessionFile(session, symbolList);
        instance.entries.set(root.uri.toString(), root);
        for (const each of root.entries.entries()) {
          instance.entries.set(each[0], each[1] as GsDictionaryFile);
        };
        const workspaceFolders = vscode.workspace.workspaceFolders;
        //   If the first workspace folder is added, removed or changed, the currently executing extensions 
        //    (including the one that called this method) will be terminated and restarted so that the (deprecated) 
        //    rootPath property is updated to point to the first workspace folder.
        //   See isValidSetup() where we ensure that a first folder exists.
        //   Use the onDidChangeWorkspaceFolders() event to get notified when the workspace folders have been updated.
        const flag = vscode.workspace.updateWorkspaceFolders(
          workspaceFolders ? workspaceFolders.length : 0, null, ...[{'uri': root.uri, 'name': root.name}]);
        if (flag) {
          resolve(instance);
        } else {
          reject({ 'message': 'Unable to create workspace folder!' });
        }
      } catch (ex: any) {
        reject(ex);
      }
    });
  }

  async read(selector: string, oop: number): Promise<string> {
    let myString: string = '';
    let chunk: number = 1;
    while (true) {
      const nextChunk = await this._session.stringFromPerform(selector, [oop, chunk * 8 + 2]);
      myString += nextChunk;
      if (nextChunk.length < 25000) {
        return myString;
      }
      ++chunk;
    }
  }

  // https://github.com/microsoft/vscode/issues/157859
  async readDirectory(parentUri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const regexp = /^gs\d+:\/session-\d+$/g;
    if (regexp.test(parentUri.toString())) {
      return new Promise(async (resolve, reject) => {
        const list: [string, vscode.FileType][] = [];
        const gsSessionFile: GsSessionFile = this.entries.get(parentUri.toString())! as GsSessionFile;
        for (const each of gsSessionFile.entries.values()) {
          list.push([each.name, vscode.FileType.Directory]);
        }
        resolve(list);
      });
    };
    return new Promise(async (resolve, reject) => {
      const result: [string, vscode.FileType][] = [];
      try {
        const aGsDictionaryFile: GsDictionaryFile = this.entries.get(parentUri.toString())! as GsDictionaryFile;
        let myString: string = await this.read('getClassesInDictionary:chunk:', aGsDictionaryFile.oop);
        JSON.parse(myString).list.forEach((eachClass: { oop: number, name: string, size: number, md5: string }) => {
          const newUri = vscode.Uri.parse(parentUri.toString() + '/' + eachClass.name);
          const newEntry: GsClassFile = aGsDictionaryFile.addEntry(this._session, eachClass);
          this.entries.set(newUri.toString(), newEntry);
          result.push([eachClass.name, newEntry.type]);
        });
        resolve(result);
      } catch (e: any) {
        console.log(`readDirectory() - error - ${e}`);
        reject(e);
      }
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.toString().includes('.vscode')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const entry: GsClassFile = this.entries.get(uri.toString())! as GsClassFile;
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return new Promise(async (resolve, reject) => {
      try {
        let result = await this.read('fileOutClass:chunk:', entry.oop);
        resolve(this.str2ab(result));
      } catch (e: any) {
        console.log(`readFile() - error - ${e}`);
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
    if (uri.toString().includes('.git')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (uri.toString().includes('.vscode')) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const entry: vscode.FileStat = this.entries.get(uri.toString())!;
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
