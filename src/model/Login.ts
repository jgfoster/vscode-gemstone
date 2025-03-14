/*
 * Login.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';

export class Login extends vscode.TreeItem {
	constructor(
		public readonly label: any,
		public readonly gem_host: string,
		public readonly gem_port: number,
		public readonly gs_user: string,
		public readonly gs_password: string,
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.tooltip = `${this.gs_user} on ${this.gem_host}:${this.gem_port}`;
		this.description = this.tooltip;
	}
	return: any;
}
