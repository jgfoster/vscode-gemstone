
import * as vscode from 'vscode';
import { Session } from './Session';
import { assert } from 'console';
import { SymbolDictionary } from './SymbolDictionary';
// import { urlToOptions } from 'vscode-test/out/util';

export interface GsFile {
	ctime: number;
	mtime: number;
	size: number;
  type: vscode.FileType;

  addEntry(_session: Session, _element: any): GsClassFile | GsDictionaryFile | GsSessionFile;
}

export class GsClassFile implements vscode.FileStat, GsFile {
  ctime: number = Date.now();
  mtime: number = Date.now();
  size: number;
  type: vscode.FileType = vscode.FileType.File;

  md5: string;
  name: string;
  session: Session;
  oop: number;

  constructor(session: Session, data: { oop: number, name: string, size: number, md5: string }) {
    this.size = data.size;
    this.name = data.name;
    this.session = session;
    this.oop = data.oop;
    this.md5 = data.md5;
  }

  addEntry(_session: Session, _element: any) {
    return this;
  }
}

export class GsDictionaryFile implements vscode.FileStat, GsFile {
	ctime: number;
	mtime: number;
	size: number;
	type: vscode.FileType;

	name: string;
	entries: Map<string, GsClassFile> = new Map;
	session: Session;
	oop: number;

	constructor(session: Session, aSymbolDictionary: SymbolDictionary, index: number) {
		this.type = vscode.FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = aSymbolDictionary.size;
		this.name = `${index + 1}-${aSymbolDictionary.name}`;
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

export class GsSessionFile implements vscode.FileStat, GsFile {
	ctime: number;
	mtime: number;
	size: number;
	type: vscode.FileType;

	entries: Map<string, GsDictionaryFile> = new Map;
	session: Session;
  uri: vscode.Uri;
  
  addEntry(_session: Session, _element: any) {
    return new GsSessionFile(_session, _element);
  }

	constructor(session: Session, dictionaries: SymbolDictionary[]) {
		this.type = vscode.FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = dictionaries.length;
		this.session = session;
    this.uri = vscode.Uri.parse('gs://');
    dictionaries.forEach((aSymbolDictionary: SymbolDictionary, index: number) => {
      const uri: vscode.Uri = vscode.Uri.parse(`gs://${index + 1}-${aSymbolDictionary.name}`);
      const gsDictionaryFile: GsDictionaryFile = new GsDictionaryFile(session, aSymbolDictionary, index);
      this.entries.set(uri.toString(), gsDictionaryFile);
    });
	}

	getChildren(uri: vscode.Uri): [string, vscode.FileType][] {
		console.log(`GsSessionFile.getChildren(${uri.toString()})`);
		let result: [string, vscode.FileType][] = [];
		if (this.entries) {
			for (const [name, child] of this.entries) {
				result.push([name, vscode.FileType.Directory]);
			}
		}
		return result;
	}
}
