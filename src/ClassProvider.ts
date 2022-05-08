import * as vscode from 'vscode';
import { Session } from './Session';
import JadeServer from './JadeServer';

export class ClassesProvider implements vscode.TreeDataProvider<GsClass> {
	private session: Session | undefined;
	private _onDidChangeTreeData: vscode.EventEmitter<GsClass | undefined> = new vscode.EventEmitter<GsClass | undefined>();
	readonly onDidChangeTreeData: vscode.Event<GsClass | undefined> = this._onDidChangeTreeData.event;
	jadeServer: number;
	symbolDictionaries: { [key: string]: { oop: number, name: string, size: number } };
	activeDictionary: { oop: number, name: string, size: number } | null;
	classHierarchy: any;
	classSuperPairs: any;
	allClasses: string[];

	constructor() {
		this.jadeServer = 1;    // OOP_ILLEGAL
		this.symbolDictionaries = {};
		this.activeDictionary = { oop: 1, name: '', size: 0 };
		this.classHierarchy = {};
		this.classSuperPairs = {};
		this.allClasses = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	setSession(session: Session): void {
		this.session = session;
		// obtain list of SymbolDictionary instances
		try {
			this.jadeServer = session.oopFromExecuteString(JadeServer);
			const myString = session.stringFromPerform(this.jadeServer, 'getSymbolList', [], 1024);
			JSON.parse(myString).list.forEach((element: { oop: number, name: string, size: number }) => {
				this.symbolDictionaries[element.name] = element;
			});
		} catch (e: any) {
			console.error("ERROR INSIDE SET SESSION: ", e.message);
		}
	}

	setSymbolDictionary(selection: string | undefined): void {
		if (selection && this.session) {
			this.activeDictionary = this.symbolDictionaries[selection];
			const myString = this.session.stringFromPerform(
				this.jadeServer,
				'getSymbolListWithSelectorsCount:',
				[this.activeDictionary.oop],
				65525
			);
			JSON.parse(myString).list.forEach((element: any) => {
				if (this.session) {
					var superClass = this.session.stringFromPerform(
						this.jadeServer,
						'getAncestor:',
						[element.oop],
						65525
					);
					if (this.classSuperPairs[superClass]) {
						this.classSuperPairs[superClass].push(element);
					} else {
						this.classSuperPairs[superClass] = [element];
					}
				}
			});
			this.classHierarchy = this.getHierarchyFromPairs(this.classSuperPairs);
		} else {
			this.activeDictionary = null;
		}
	}

	getHierarchyFromPairs(pairs: { [x: string]: any[]; }, key = "Object") {
		var hierarchy: {[k: string]: any}  = {};
		if (key in Object.keys(pairs)) {
			for (var i = 0; i < pairs[key].length; i++) {
				var tempObj = pairs[key][i];
				pairs[key].splice(i, 1);
				if (!(key in hierarchy)) {
					hierarchy[key] = [];
				}
				hierarchy[key].push(this.getHierarchyFromPairs(pairs, tempObj.key));
				pairs[key].splice(i, 0, tempObj);
			}
			return hierarchy;
		}
		return { [key]: [] };
	}

	getSession(): Session | undefined {
		return this.session;
	}

	getSymbolDictionaries() {
		return this.symbolDictionaries;
	}

	getTreeItem(element: GsClass): vscode.TreeItem {
		return element;
	}

	hasChildren(name: string): boolean {
		return Object.keys(this.classSuperPairs).indexOf(name) > -1
	}

	async getChildren(element?: GsClass): Promise<GsClass[]> {
		if (!this.session) {
			return Promise.resolve([]);
		}
		if (element) {
			if (this.hasChildren(element.label)) {
				return Promise.resolve(
					this.classSuperPairs[element.label].map((obj: any): GsClass => {
						return new GsClass(
							obj.key,
							this.hasChildren(obj.key) ?
								vscode.TreeItemCollapsibleState.Collapsed :
								vscode.TreeItemCollapsibleState.None,
							{
								command: "gemstone.fetchMethods",
								title: "doc",
								arguments: [obj]
							}
						)
					})
				);
			} else {
				return Promise.resolve([]);
			}
		}
		return Promise.resolve([new GsClass("Object", vscode.TreeItemCollapsibleState.Expanded)]); // TODO: FETCH METHODS FOR OBJECT
	}

	displayClassFinder() {
		if (!this.session) {
			console.log("NO SESSION ACTIVE");
			return;
		}
		if (this.allClasses.length == 0) {
			var allClassesString = this.session.stringFromPerform(this.jadeServer, 'getAllClasses', [], 65525);
			this.allClasses = JSON.parse(allClassesString);
		}
		vscode.window.showQuickPick(this.allClasses)
			.then(console.log)
	}
}

export class GsClass extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		this.tooltip = this.label;
	}
}
