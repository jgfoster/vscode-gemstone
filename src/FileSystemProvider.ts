/*---------------------------------------------------------------------------------------------
 *  based on https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
 *--------------------------------------------------------------------------------------------*/


import * as path from 'path';
import * as vscode from 'vscode';
import { Session } from './Session';
import { Directory } from './Directory';
import { SymbolDictionary } from './SymbolDictionary';
import { SymbolList } from './SymbolList';
import { File } from './File';

export type Entry = File | Directory;

export class GemStoneFS implements vscode.FileSystemProvider {
    session: Session;
    root: Directory;
    constructor(session: Session) {
        const sessionId = session.sessionId.toString();
        this.session = session;
        this.root = new Directory(this.session, this.session.description, null);
        this.createMyDirectory(SymbolDictionary, null, vscode.Uri.parse('gs' + sessionId + ':/Smalltalk'));
        this.createMyDirectory(SymbolList, null, vscode.Uri.parse('gs' + sessionId + ':/SymbolList'));
    }

    // --- manage file metadata

    stat(uri: vscode.Uri): vscode.FileStat {
        if (uri.toString().includes('.vscode')) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        console.log('stat', uri.toString());
        return this._lookup(uri, false);
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        console.log('readDirectory', uri.toString());
        return this._lookupAsDirectory(uri, false).getChildren(uri);
    }

    // --- manage file contents

    readFile(uri: vscode.Uri): Uint8Array {
        if (uri.toString().includes('.vscode')) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        console.log('GemStoneFS.readFile(' + uri.toString() + ')');
        const data = this._lookupAsFile(uri, false).data;
        if (data) {
            return data;
        }
        throw vscode.FileSystemError.FileNotFound();
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        console.log('GemStoneFS.writeFile(' + uri.toString() + ')');
        let basename = path.posix.basename(uri.path);
        let parent = this._lookupParentDirectory(uri);
        let entry;
        if (parent.entries) {
            entry = parent.entries.get(basename);
        }
        if (entry instanceof Directory) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }
        if (!entry && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (entry && options.create && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        if (!entry) {
            entry = new File(this.session, basename);
            parent.addEntry(basename, entry);
            this._fireSoon({ type: vscode.FileChangeType.Created, uri });
        }
        entry.mtime = Date.now();
        entry.size = content.byteLength;
        entry.data = content;

        this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    }

    // --- manage files/folders

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        console.log('GemStoneFS.rename(' + oldUri.toString() + ', ' + newUri.toString() + ')');

        if (!options.overwrite && this._lookup(newUri, true)) {
            throw vscode.FileSystemError.FileExists(newUri);
        }

        let entry = this._lookup(oldUri, false);
        let oldParent = this._lookupParentDirectory(oldUri);

        let newParent = this._lookupParentDirectory(newUri);
        let newName = path.posix.basename(newUri.path);
        if (oldParent.entries) {
            oldParent.entries.delete(entry.name);
        }
        entry.name = newName;
        newParent.addEntry(newName, entry);

        this._fireSoon(
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        );
    }

    delete(uri: vscode.Uri): void {
        console.log('GemStoneFS.delete(' + uri.toString() + ')');
        let dirname = uri.with({ path: path.posix.dirname(uri.path) });
        let basename = path.posix.basename(uri.path);
        let parent = this._lookupAsDirectory(dirname, false);
        if (!parent.entries || !parent.entries.has(basename)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        parent.entries.delete(basename);
        parent.mtime = Date.now();
        parent.size -= 1;
        this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted });
    }

    createDirectory(uri: vscode.Uri): void {
        this.createMyDirectory(Directory, null, uri);
    }

    createMyDirectory(classRef: typeof Directory, data: any, uri: vscode.Uri): void {
        let basename = path.posix.basename(uri.path);
        let dirname = uri.with({ path: path.posix.dirname(uri.path) });
        let parent = this._lookupAsDirectory(dirname, false);

        let entry = new classRef(this.session, basename, data);
        parent.addEntry(entry.name, entry);
        parent.mtime = Date.now();
        parent.size += 1;
        this._fireSoon(
            { type: vscode.FileChangeType.Changed, uri: dirname }, 
            { type: vscode.FileChangeType.Created, uri }
        );
    }

    // --- lookup

    private _lookup(uri: vscode.Uri, silent: false): Entry;
    private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined;
    private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined {
        let parts = uri.path.split('/');
        let entry: Entry = this.root;
        for (const part of parts) {
            if (!part) {
                continue;
            }
            let child: Entry | undefined;
            if (entry instanceof Directory && entry.entries) {
                child = entry.entries.get(part);
            }
            if (!child) {
                if (!silent) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                } else {
                    return undefined;
                }
            }
            entry = child;
        }
        return entry;
    }

    private _lookupAsDirectory(uri: vscode.Uri, silent: boolean): Directory {
        let entry = this._lookup(uri, silent);
        if (entry instanceof Directory) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    private _lookupAsFile(uri: vscode.Uri, silent: boolean): File {
        let entry = this._lookup(uri, silent);
        if (entry instanceof File) {
            return entry;
        }
        throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    private _lookupParentDirectory(uri: vscode.Uri): Directory {
        const dirname = uri.with({ path: path.posix.dirname(uri.path) });
        return this._lookupAsDirectory(dirname, false);
    }

    // --- manage file events

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_resource: vscode.Uri): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}