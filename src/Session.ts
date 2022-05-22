/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';
import internal = require('stream');
const WebSocket = require("ws");

export class Session extends vscode.TreeItem {
	session: String;
	socket: typeof WebSocket;
	_onLogin!: (session: Session) => void;
	_onLogout!: (session: Session) => void;
	constructor(
		public readonly login: Login,
		public readonly sessionId: number,
		_onLogin: (session: Session) => void,
		_onLogout: (session: Session) => void
	) {
		super(login.label, vscode.TreeItemCollapsibleState.None);
		this.session = '';
		this.getSocket();
		console.log(this._onLogin, this._onLogout);
		// this._onLogin(this);
		// this._onLogout(this);
		this.command = {
			command: 'gemstone-sessions.selectSession',
			title: 'Select session',
			arguments: [this]
		};
		this.tooltip = `${this.sessionId}: ${this.login.tooltip}`;
		this.description = this.tooltip;
	}

	getSocket() {
		this.socket = new WebSocket(`ws://${this.login.gem_host}:${this.login.gem_port}/webSocket.gs`);
		 this.socket.on('close', (event: any) => {
			console.log('close', event);
		});
		this.socket.on('error', (event: any) => {
			console.log('error', event);
		});
		this.socket.on('message', (event: any) => {
			let obj = JSON.parse(String.fromCharCode(...event));
			console.log(obj);
			switch (obj._request) {
				case "getGciVersion":
					console.log("getGciVersion", obj.version.split(' ')[0]);
					break;
				case "login":
					console.log("login", obj.result);
					this._onLogin(this);
					break;
				default:
					console.log(obj);
					break;
			}
		});
		this.socket.on('open', () => {
			try {
				this.socket.send('{"request": "getGciVersion", "id": 0}', {}, (ex: any) => {
					if (typeof ex !== "undefined") {
						console.log(ex);
					}
				});
				let json = '{' +
					'"request": "login", "id": 1, ' +
					'"username": "' + this.login.gs_user + '", ' +
					'"password": "' + this.login.gs_password + '"' +
					'}';
					this.socket.send(json, {}, (ex: any) => {
					if (typeof ex !== "undefined") {
						console.log(ex);
					}
				});
			} catch (error) {
				console.log(error);
			}
		});

	}

	commit() {
		console.log('commit');
		// this.gciSession.commit();
	}

	oopFromExecuteString(input: string): number {
		console.log('oopFromExecuteString(input: string)');
		// return this.gciSession.execute(input);
		return 0;
	}

	stringFromExecute(input: string, size: number = 1024): string {
		console.log('stringFromExecute(input: string, size: number = 1024)');
		// const myString = '| x | x := [' + input + '] value. ' +
		// 	'x size > ' + (size - 4).toString() +
		// 	' ifTrue: [x := (x copyFrom: 1 to: ' + (size - 4).toString() + ') , \'...\']. x';
		// return this.gciSession.executeFetchBytes(myString, size);
		return 'nil';
	}

	stringFromPerform(receiver: number, selector: string, oopArray: number[], expectedSize: number): string {
		console.log('stringFromPerform()');
		// return this.gciSession.performFetchBytes(receiver, selector, oopArray, expectedSize);
		return 'nil';
	}

	isLoggedIn() {
		console.log('isLoggedIn()', this.session);
		return this.session !== "";
	}

	logout() {
		console.log('logout()');
		// this.gciSession.logout();
		// // remove this session's SymbolDictionaries (folders) from the workspace
		// const prefix = 'gs' + this.sessionId.toString() + ':/';
		// const workspaceFolders = vscode.workspace.workspaceFolders || [];
		// let start, end;
		// for (let i = 0; i < workspaceFolders.length; i++) {
		// 	if (workspaceFolders[i].uri.toString().startsWith(prefix)) {
		// 		if (!start) {
		// 			start = i;
		// 			end = i;
		// 		} else {
		// 			end = i;
		// 		}
		// 	}
		// }
		// if (start && end) {
		// 	const flag = vscode.workspace.updateWorkspaceFolders(start, end - start + 1);
		// 	if (!flag) {
		// 		console.log('Unable to remove workspace folders!');
		// 		vscode.window.showErrorMessage('Unable to remove workspace folders!');
		// 	}
		// }
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
