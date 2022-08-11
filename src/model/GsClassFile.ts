
import * as vscode from 'vscode';
import { Session } from './Session';

export interface GsFile {
    oop: number;
    size: number;
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

    constructor(session: Session, name: string, data: any) {
        this.size = data.size;
        this.name = name;
        this.session = session;
        this.oop = data.oop;
        this.md5 = data.md5;
    }
}
