/*---------------------------------------------------------------------------------------------
 *  based on https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Session } from './Session';
import { GsDictionaryFile } from './GsDictionaryFile';
import { GsClassFile } from './GsClassFile';
import { File } from './File';
import JadeServer from './JadeServer';

export type Entry = File | GsDictionaryFile | GsClassFile;

function str2ab(str: string): Uint8Array {
    var buf = new ArrayBuffer(str.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return bufView;
}

export class GemStoneFS implements vscode.FileSystemProvider {
    session: Session;
    jadeServer: number;
    map: Map<any, any>;
    constructor(session: Session) {
        this.session = session;
        this.jadeServer = 1;    // OOP_ILLEGAL
        this.map = new Map();
        // obtain list of SymbolDictionary instances
        try {
            // console.log('GemStoneFS class constructor');
            this.jadeServer = session.oopFromExecuteString(JadeServer);
            const myString = session.stringFromPerform(this.jadeServer, 'getSymbolList', [], 1024);
            const list = JSON.parse(myString).list.map((each: any) => {
                const uri = vscode.Uri.parse('gs' + session.sessionId.toString() + ':/' + each.name);
                const dict = new GsDictionaryFile(session, each.name, each);
                this.map.set(uri.toString(), dict);
                return {
                    'uri': uri,
                    'name': each.name
                };
            });
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const flag = vscode.workspace.updateWorkspaceFolders(
                workspaceFolders ? workspaceFolders.length : 0,
                0,
                ...list
            );
            if (!flag) {
                console.error('Unable to create workspace folder!');
                vscode.window.showErrorMessage('Unable to create workspace folder!');
                return;
            }
        } catch (e: any) {
            console.error(e.message);
        }
    }

    // --- manage file metadata

    // return a FileStat-type (ctime: number, mtime: number, size: number, type: FileType)
    stat(uri: vscode.Uri): vscode.FileStat {
        if (uri.toString().includes('.vscode')) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const entry = this.map.get(uri.toString());
        if (!entry) {
            console.error('stat(\'' + uri.toString() + '\') entry not found!');
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return entry;
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const result: [string, vscode.FileType][] = new Array;
        try {
            const dict = this.map.get(uri.toString());
            const myString = this.session.stringFromPerform(
                this.jadeServer,
                dict.getExpansionString(),
                [dict.oop],
                65525
            );
            JSON.parse(myString).list.forEach((element: any) => {
                const newUri = vscode.Uri.parse(uri.toString() + '/' + element.key);
                const newEntry = dict.addEntry(this.session, element.key, element);
                this.map.set(newUri.toString(), newEntry);
                result.push([element.key, newEntry.type]);
            });
        } catch (e: any) {
            console.error(e.message);
        }
        return result;
    }

    // --- manage file contents

    getMethodString(entry: File): Uint8Array {
        const classString: string = this.session.stringFromPerform(entry.gsClassOop, 'fileOutClass', [], 65525);
        const instanceMethodsString: string = classString.split(`! ------------------- Instance methods for ${entry.gsClass}`)[1];
        const methodStrings: Array<string> = instanceMethodsString.split("%");
        for (var methodString of methodStrings) {
            var re = /method: .*$\n^(.*)/gm;
            var match = re.exec(methodString); // TODO: fix matches for comparison methods (such as =>) and keyword methods
            if (match && match[1] == entry.name) {
                return str2ab(methodString.split(`method: ${entry.gsClass}`)[1].trim());
            }
        }
        return str2ab('We do not yet support \'' + entry.gsClass + '\' instances!');
    }

    readFile(uri: vscode.Uri): Uint8Array {
        if (uri.toString().includes('.vscode')) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const entry: File = this.map.get(uri.toString());
        if (!entry) {
            console.error('stat(\'' + uri.toString() + '\') entry not found!');
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return this.getMethodString(entry);
    }

    uint8ArrayToExecutableString(array: Uint8Array) {
        var string = String.fromCharCode.apply(null, (array as any));
        var executableString = string.replace(RegExp(`'`, 'g'), `''`);
        return executableString;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        const entry: File = this.map.get(uri.toString());
        try {
            var executeString: string = `${entry.gsClass} compileMethod: '${this.uint8ArrayToExecutableString(content)}'`;
            console.log('GemStoneFS.writeFile(' + uri.toString() + ')');
            console.log('content: ', executeString);
            this.session.oopFromExecuteString(executeString);
            this.session.commit();
        }
        catch (e) {
            console.log("ERROR", e);
        }
    }

    // --- manage files/folders

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        console.log('GemStoneFS.rename(' + oldUri.toString() + ', ' + newUri.toString() + ')');
    }

    delete(uri: vscode.Uri): void {
        console.log('GemStoneFS.delete(' + uri.toString() + ')');
    }

    createDirectory(uri: vscode.Uri): void {
        console.log('GemStoneFS.createDirectory(' + uri.toString() + ')');
    }

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_resource: vscode.Uri): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }
}
