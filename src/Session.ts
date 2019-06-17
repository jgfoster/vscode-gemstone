/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';

export class Session extends vscode.TreeItem {
	constructor(
		public readonly login: Login,
		public readonly session: any
	) {
		super(login.label, vscode.TreeItemCollapsibleState.None);
	}

	get tooltip(): string {
		return `${this.login.gs_user} in ${this.login.stone} (${this.login.version}) on ${this.login.gem_host} (${this.session.session})`;
	}

	get description(): string {
		return this.tooltip;
	}

	logout() {
		this.session.logout();
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
