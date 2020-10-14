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
		var classString: string = this.session.stringFromPerform(obj.oop, 'fileOutClass', [], 65525);
        var classMethodStrings: string = classString.split(`! ------------------- Class methods for ${obj.key}`)[1];
        var methodStrings: Array<string> = classMethodStrings.split("%");
        for (var i = 0; i < methodStrings.length; i++) {
			var methodString = methodStrings[i];
            var re = /classmethod: .*$\n^(.*)/gm;
            var match = re.exec(methodString); // TODO: fix matches for comparison methods (such as =>) and keyword methods
            if (match) {
				var text = methodString.split(`classmethod: ${obj.key}`)[1].trim();
				var name = text.split("\n")[0];
				var method = new GsMethod(name, "class", vscode.TreeItemCollapsibleState.None, {
					command: "gemstone.openDocument",
					title: "OPEN",
					arguments: [text]
				});
				this.methodList.push(method);
            }
        }
		var classString: string = this.session.stringFromPerform(obj.oop, 'fileOutClass', [], 65525);
        var instanceMethodsString: string = classString.split(`! ------------------- Instance methods for ${obj.key}`)[1];
        var methodStrings: Array<string> = instanceMethodsString.split("%");
        for (var i = 0; i < methodStrings.length; i++) {
			var methodString = methodStrings[i];
            var re = /method: .*$\n^(.*)/gm;
            var match = re.exec(methodString); // TODO: fix matches for comparison methods (such as =>) and keyword methods
            if (match) {
				var text = methodString.split(`method: ${obj.key}`)[1].trim();
				var name = text.split("\n")[0];
				var method = new GsMethod(name, "instance", vscode.TreeItemCollapsibleState.None, {
					command: "gemstone.openDocument",
					title: "OPEN",
					arguments: [text]
				});
				this.methodList.push(method);
            }
        }
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
