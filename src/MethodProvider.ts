import * as vscode from 'vscode';
import { Session } from './Session';
import JadeServer from './JadeServer';

function str2ab(str: string): Uint8Array { // TODO: CONDENSE REPEAT CODE
    var buf = new ArrayBuffer(str.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return bufView;
}

export class MethodsProvider implements vscode.TreeDataProvider<GsMethod> {
	private session: Session | undefined;
	private _onDidChangeTreeData: vscode.EventEmitter<GsMethod | undefined> = new vscode.EventEmitter<GsMethod | undefined>();
	readonly onDidChangeTreeData: vscode.Event<GsMethod | undefined> = this._onDidChangeTreeData.event;
	jadeServer: number;
	methodList: GsMethod[];

	constructor() {
		this.jadeServer = 1;    // OOP_ILLEGAL
		this.methodList = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	setSession(session: Session): void {
		this.session = session;
	}

	getMethodsFor(obj: any) {
		this.methodList = [];
		this.extractMethods(
			`! ------------------- Class methods for ${obj.key}`,
			`classmethod: ${obj.key}`,
			"classmethod: .*$\n^(.*)",
			"class",
			obj.oop
		)
		this.extractMethods(
			`! ------------------- Instance methods for ${obj.key}`,
			`method: ${obj.key}`,
			"method: .*$\n^(.*)",
			"instance",
			obj.oop
		)
	}

	extractMethods(majorSplitter: string, minorSplitter: string, regexString: string, type: string, oop: number) {
		var classString: string = this.session!.stringFromPerform(oop, 'fileOutClass', [], 65525);
		var classMethodStrings: string = classString.split(majorSplitter)[1];
        var methodStrings: Array<string> = classMethodStrings.split("%");
        for (var i = 0; i < methodStrings.length; i++) {
			var methodString = methodStrings[i];
			var re = new RegExp(regexString, "gm");
            var match = re.exec(methodString);
            if (match) {
				this.extractMethod(methodString, type, minorSplitter);
            }
        }
	}

	extractMethod(methodString: string, type: string, splitter: string) {
		var text = methodString.split(splitter)[1].trim();
		var name = text.split("\n")[0];
		if (name.includes(":")) { // deal with keyword method case
			var isEven = true;
			name = name.split(" ").reduce((acc: string, cur: string) => {
				if (isEven) {
					acc = acc.concat(cur);
				}
				isEven = !isEven;
				return acc;
			}, "")
		} else if ((/[+|-|*|/|&|=|>|||<|~|@]/gm).exec(name)) { // deal with binary method case
			name = name.split(" ")[0];
		}
		var method = new GsMethod(name, type, vscode.TreeItemCollapsibleState.None, {
			command: "gemstone.openDocument",
			title: "OPEN",
			arguments: [text]
		});
		this.methodList.push(method);
	}

	getTreeItem(element: GsMethod): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: GsMethod): Promise<GsMethod[]> {
		if (!this.session) {
			return Promise.resolve([]);
		}
		return Promise.resolve(this.methodList);
	}
}

export class GsMethod extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly type: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		this.tooltip = this.label;
		this.description = this.type;
	}
}