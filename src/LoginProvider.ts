import * as vscode from 'vscode';
import { Login } from './Login';

export class LoginsProvider implements vscode.TreeDataProvider<Login> {

	private _onDidChangeTreeData: vscode.EventEmitter<Login | undefined> = new vscode.EventEmitter<Login | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Login | undefined> = this._onDidChangeTreeData.event;

	constructor() {
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: Login): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: Login): Promise<Login[]> {
		if (element) {	// a Login does not have children
			return Promise.resolve([]);
		}
		const config = vscode.workspace.getConfiguration('gemstone');
		const logins = config.logins.map((login: any) => {
			return new Login(
				login.label,
				login.gem_host,
				login.gem_port,
				login.gs_user,
				login.gs_password
			);
		});
		if (!config || !logins || logins.length === 0) {
			vscode.window.showInformationMessage('No GemStone Logins have been defined in Settings');
			return Promise.resolve([]);
		}
		return Promise.resolve(logins);
	}

}
