
import * as vscode from 'vscode';
import { File } from './File';
import { Session } from './Session';

export class GsClassFile implements vscode.FileStat {

    type: vscode.FileType;
    ctime: number;
    mtime: number;
    size: number;

    name: string;
    entries: Map<string, File | GsClassFile> | null;
    session: Session;
    oop: number | null;

    constructor(session: Session, name: string, data: any = null) {
        this.type = vscode.FileType.Directory;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = data.size || 0;
        this.name = name;
        this.entries = null;
        this.session = session;
        this.oop = data.oop || 1;
    }

    addEntry(session: Session, key: any, element: any) {
        return new File(this.session, element.key, element);
    }

    getChildren(uri: vscode.Uri): [string, vscode.FileType][] {
        let result: [string, vscode.FileType][] = [];
        if (this.entries) {
            for (const [name, child] of this.entries) {
                result.push([name, child.type]);
            }
        }
        return result;
    }

    getExpansionString(): string {
        return 'getSelectors:';
    }
}
