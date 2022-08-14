import * as vscode from 'vscode';
import { Session } from '../model/Session';

export class SessionsProvider implements vscode.TreeDataProvider<Session> {
	private sessions: Session[];
	private _onDidChangeTreeData: vscode.EventEmitter<Session | undefined | null | void> = new vscode.EventEmitter<Session | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Session | undefined | null | void> = this._onDidChangeTreeData.event;

	constructor(list: Session[]) {
		this.sessions = list;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(session: Session): vscode.TreeItem {
		return session;
	}

	async getChildren(session?: Session): Promise<Session[]> {
		if (session) {	// a Session does not have children
			return Promise.resolve([]);
		}
		// return top-level elements (children of root)
		return Promise.resolve(this.sessions);
	}

	getParent(_: Session) {
		return null;	// a Session is always a top-level entity
	}
}
