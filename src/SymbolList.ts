
import * as vscode from 'vscode';
import { Directory } from './Directory';
import { Session } from './Session';
import { SymbolDictionary } from './SymbolDictionary';

export class SymbolList extends Directory {

    constructor(session: Session, name: string, data: any) {
        super(session, name);
    }

    getChildren(uri: vscode.Uri): [string, vscode.FileType][] {
        let result: [string, vscode.FileType][] = [];
        try {
            if (!this.entries) {
                this.entries = new Map();
                let myString = `
| comma stream |
stream := WriteStream on: String new.
stream nextPutAll: '{"list":['.
comma := ''.
System myUserProfile symbolList do: [:each | 
    stream 
        nextPutAll: comma;
        nextPutAll: '{"oop":';
        print: each asOop;
        nextPutAll: ',"name":"';
        nextPutAll: each name;
        nextPutAll: '","size":';
        print: each size;
        nextPutAll: '}';
        yourself.
    comma := ','.
].
stream nextPutAll: ']}'; contents.
`;
                myString = this.session.stringFromExecute(myString, 1024);
                let i = 1;
                for (let each of JSON.parse(myString).list) {
                    let dict = new SymbolDictionary(
                        this.session,
                        each.name, 
                        each);
                    this.addEntry((i++).toString() + ': ' + each.name + ' (' + each.size.toString() + ')', dict);
                }
            }
            for (const [name, child] of this.entries) {
                result.push([name, child.type]);
            }
        } catch(e) {
            console.error(e.message);
        }
        return result;
    }
}
