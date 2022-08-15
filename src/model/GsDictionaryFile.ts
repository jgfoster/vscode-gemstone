
import * as vscode from 'vscode';
import { Session } from './Session';
import { GsFile, GsClassFile } from './GsClassFile';
import { assert } from 'console';
import { SymbolDictionary } from '../model/SymbolDictionary';


export class GsDictionaryFile implements vscode.FileStat, GsFile {

	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	entries: Map<string, GsClassFile> = new Map;
	session: Session;
	oop: number;

	constructor(session: Session, aSymbolDictionary: SymbolDictionary) {
		this.type = vscode.FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = aSymbolDictionary.size;
		this.name = aSymbolDictionary.name;
		this.session = session;
		this.oop = aSymbolDictionary.oop;
	}

	addEntry(session: Session, element: { oop: number, name: string, size: number, md5: string }) {
		assert(this.session === session);
		return new GsClassFile(session, element);
	}

	getChildren(uri: vscode.Uri): [string, vscode.FileType][] {
		console.log('getChildren', uri.toString());
		let result: [string, vscode.FileType][] = [];
		if (this.entries) {
			for (const [name, child] of this.entries) {
				result.push([name, child.type]);
			}
		}
		return result;
	}
}
