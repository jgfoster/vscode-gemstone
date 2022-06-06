
import * as vscode from 'vscode';
import { File } from './File';
import { Session } from './Session';
import { GsClassFile } from './GsClassFile';

export class GsDictionaryFile implements vscode.FileStat {

	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	entries: Map<string, GsClassFile> = new Map;
	session: Session;
	oop: number;

	constructor(session: Session, name: string, data: any) {
		this.type = vscode.FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = data.size;
		this.name = name;
		this.session = session;
		this.oop = data.oop;
	}

	addEntry(session: Session, key: any, element: any) {
		return new GsClassFile(this.session, element.key, element);
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
