import * as vscode from 'vscode';
import { Session } from '../model/Session';

export class SessionsProvider implements vscode.TreeDataProvider<Session> {
	private sessions: Session[];
	private _onDidChangeTreeData: vscode.EventEmitter<Session | undefined> = new vscode.EventEmitter<Session | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Session | undefined> = this._onDidChangeTreeData.event;

	constructor(list: Session[]) {
		this.sessions = list;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: Session): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: Session): Promise<Session[]> {
		if (element) {	// a Session does not have children
			return Promise.resolve([]);
		}
		// return top-level elements (children of root)
		return Promise.resolve(this.sessions.filter(each => each.isLoggedIn));
	}

	getParent(_: Session) {
		return null;	// a Session is always a top-level entity
	}
}
