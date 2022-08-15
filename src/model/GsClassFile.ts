
import * as vscode from 'vscode';
import { Session } from './Session';

export interface GsFile {
  oop: number;
  size: number;
  type: vscode.FileType;
  ctime: number;
  mtime: number;

  addEntry(_session: Session, _element: any): GsClassFile;
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
