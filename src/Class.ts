
import * as vscode from 'vscode';
import { File } from './File';
import { Session } from './Session';

export class Class extends File {
    oop: number | null;
    constructor(session: Session, name: string, data: any) {
        super(session, name);
        this.oop = null;
    }
}