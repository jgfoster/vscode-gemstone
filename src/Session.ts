/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';
const { GciSession } = require('gci');

export class Session extends vscode.TreeItem {
	gciSession: any;
	constructor(
		public readonly login: Login,
		public readonly sessionId: number
	) {
		super(login.label, vscode.TreeItemCollapsibleState.None);
		this.gciSession = new GciSession(login);
		this.tooltip = `${this.sessionId}: ${this.login.gs_user} in ${this.login.stone} (${this.login.version}) on ${this.login.gem_host}`;
		this.description = this.tooltip;
		this.command = {
			command: 'gemstone-sessions.selectSession',
			title: 'Select session',
			arguments: [this]
		};
	}

	commit() {
		this.gciSession.commit();
	}

	oopFromExecuteString(input: string): number {
		return this.gciSession.execute(input);
	}

	stringFromExecute(input: string, size: number = 1024): string {
		const myString = '| x | x := [' + input + '] value. ' + 
			'x size > ' + (size - 4).toString() + 
			' ifTrue: [x := (x copyFrom: 1 to: ' + (size - 4).toString() + ') , \'...\']. x';
		return this.gciSession.executeFetchBytes(myString, size);
	}

	stringFromPerform(receiver: number, selector: string, oopArray: number[], expectedSize: number): string {
		return this.gciSession.performFetchBytes(receiver, selector, oopArray, expectedSize);
	}

	isLoggedIn() {
		return this.gciSession.session !== 0;
	}

	logout() {
		this.gciSession.logout();
		// remove this session's SymbolDictionaries (folders) from the workspace
		const prefix = 'gs' + this.sessionId.toString() + ':/';
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		let start, end;
		for (let i = 0; i < workspaceFolders.length; i++) {
			if (workspaceFolders[i].uri.toString().startsWith(prefix)) {
				if (!start) {
					start = i;
					end = i;
				} else {
					end = i;
				}
			}
		}
		if (start && end) {
			const flag = vscode.workspace.updateWorkspaceFolders(start, end - start + 1);
			if (!flag) {
				console.log('Unable to remove workspace folders!');
				vscode.window.showErrorMessage('Unable to remove workspace folders!');
			}
		}
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
