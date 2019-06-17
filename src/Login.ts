/*
 * Login.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';

export class Login extends vscode.TreeItem {
	constructor(
		public readonly label: any,
		public readonly library: string,
		public readonly version: string,
		public readonly gem_host: string,
		public readonly stone: string,
		public readonly gs_user: string,
		public readonly gs_password: string,
		public readonly netldi: string,
		public readonly host_user: string,
		public readonly host_password: string
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
	}

	get tooltip(): string {
		return `${this.gs_user} in ${this.stone} (${this.version}) on ${this.gem_host}`;
	}

	get description(): string {
		return this.tooltip;
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
