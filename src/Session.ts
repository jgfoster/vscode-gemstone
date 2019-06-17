/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';
const { GciSession } = require('gci-js');

export class Session extends vscode.TreeItem {
	gciSession: any;
	constructor(
		public readonly login: Login,
		public readonly sessionId: number
	) {
		super(login.label, vscode.TreeItemCollapsibleState.None);
		this.gciSession = new GciSession(login);
		this.command = {
			command: 'gemstone-sessions.selectSession',
			title: 'Select session',
			arguments: [this]
		};
	}

	get tooltip(): string {
		return this.description;
	}

	get description(): string {
		return `${this.sessionId}: ${this.login.gs_user} in ${this.login.stone} (${this.login.version}) on ${this.login.gem_host}`;
	}

	isLoggedIn() {
		return this.gciSession.session !== 0;
	}

	logout() {
		this.gciSession.logout();
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
