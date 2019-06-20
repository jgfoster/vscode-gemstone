
import * as vscode from 'vscode';
import { Directory } from './Directory';
import { Session } from './Session';
import { Class } from './Class';

export class SymbolDictionary extends Directory {
    oop: number | null;
    constructor(session: Session, name: string, data: any) {
        super(session, name);
        if (data) {
            this.oop = data.oop;
            this.size = data.size;
        } else {
            this.oop = null;
        }
    }

    getChildren(uri: vscode.Uri): [string, vscode.FileType][] {
        let result: [string, vscode.FileType][] = [];
        try {
            if (!this.entries && this.oop !== null) {
                this.entries = new Map();
                let myString = `
| comma dict stream |
stream := WriteStream on: String new.
stream nextPutAll: '{"list":['.
comma := ''.
dict := Object objectForOop: ` + this.oop.toString() + `.
dict keysAndValuesDo: [:eachKey :eachValue | 
    stream 
        nextPutAll: comma;
        nextPutAll: '{"key":"';
        nextPutAll: eachKey asString;
        nextPutAll: '","oop":';
        print: eachValue asOop;
        nextPutAll: ',"class":"';
        nextPutAll: eachValue class name asString;
        nextPutAll: '","classOop":';
        print: eachValue class asOop;
        nextPutAll: '}';
        yourself.
    comma := ','.
].
stream nextPutAll: ']}'; contents.
`;
                myString = this.session.stringFromExecute(myString, 65535);
                for (let each of JSON.parse(myString).list) {
                    let dict = new Class(
                        this.session,
                        each.key, 
                        each);
                    this.addEntry(each.key, dict);
                }
            }
            for (const [name, child] of this.entries || []) {
                result.push([name, child.type]);
            }
        } catch(e) {
            console.error(e.message);
        }
        return result;
    }
}
