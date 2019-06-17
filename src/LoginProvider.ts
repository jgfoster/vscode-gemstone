import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';

export class LoginsProvider implements vscode.TreeDataProvider<Login> {

	private _onDidChangeTreeData: vscode.EventEmitter<Login | undefined> = new vscode.EventEmitter<Login | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Login | undefined> = this._onDidChangeTreeData.event;

	constructor() {
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Login): vscode.TreeItem {
		return element;
	}

	getChildren(element?: Login): Thenable<Login[]> {
		if (element) {	// a Login does not have children
			return Promise.resolve([]);
		}
		const config = vscode.workspace.getConfiguration('gemstone');
		const logins = config.logins.map((login: any) => {
			return new Login( 
				login.label, 
				login.library, 
				login.library.split('-')[1],
				login.gem_host, 
				login.stone, 
				login.gs_user, 
				login.gs_password, 
				login.netldi, 
				login.host_user, 
				login.host_password
			);
		});
		if (!config || !logins || logins.length === 0) {
			vscode.window.showInformationMessage('No GemStone Logins have been defined in Settings');
			return Promise.resolve([]);
		}
		return Promise.resolve(logins);
	}

}
