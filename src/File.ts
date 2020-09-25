
import * as vscode from 'vscode';
import { Session } from './Session';

export class File implements vscode.FileStat {

    type: vscode.FileType;
    ctime: number;
    mtime: number;
    size: number;

    name: string;
    data?: Uint8Array;
    session: Session;
    oop: number;
    gsClass: string;
    gsClassOop: number;

    constructor(session: Session, name: string, data: any = null) {
        this.type = vscode.FileType.File;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.name = name;
        this.session = session;
        this.oop = data.oop;
        this.gsClass = data.class;
        this.gsClassOop = data.classOop;
    }
}
