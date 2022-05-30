/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';
const WebSocket = require("ws");

let sessionCounter: number = 0;

export class Session extends vscode.TreeItem {
	requestCounter: number = 0;
	requests: Map<number, Array<Function>> = new Map;
	sessionId: number;
	socket: typeof WebSocket;
	version: String = '';
	constructor(
		private _login: Login
	) {
		super(_login.label, vscode.TreeItemCollapsibleState.None);
		this.sessionId = ++sessionCounter;
		this.command = {
			command: 'gemstone-sessions.selectSession',
			title: 'Select session',
			arguments: [this]
		};
		this.tooltip = `${this.sessionId}: ${this._login.tooltip}`;
		this.description = this.tooltip;
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.requests.set(0, [resolve, reject]);
			try {
				this.socket = new WebSocket(`ws://${this._login.gem_host}:${this._login.gem_port}/webSocket.gs`);
			} catch (error) {
				this.requests.clear();
				reject(error);
			}
			this.socket.on('close', (event: any) => { this.handleClose(event); });
			this.socket.on('error', (event: any) => { this.handleError(event); });
			this.socket.on('message', (event: any) => { this.handleMessage(event); });
			this.socket.on('open', (_: any) => { this.requests.delete(0); resolve(); });
		});
	}

	handleClose(_: any): void {
		this.requests.forEach(element => {
			element[1]('Connection closed!');
		});
		this.requests.clear();
	}

	handleError(event: any): void {
		this.requests.forEach(element => {
			element[1](event);
		});
		this.requests.clear();
	}

	handleMessage(event: any): void {
		const obj = JSON.parse(String.fromCharCode(...event));
		const id = obj['_id'];
		const functions = this.requests.get(id);
		this.requests.delete(id);
		if (obj['type'] === 'error') {
			functions![1](obj);
		} else {
			// console.log(`handleMessage(${event})`);
			functions![0](obj);
		}
	}

	getVersion(): Promise<String> {
		const requestId = ++this.requestCounter;
		const json = `{"request": "getGciVersion", "id": ${requestId}}`;

		return new Promise((resolve, reject) => {
			this.requests.set(requestId, [resolve, reject]);
			try {
				this.socket.send(json, {}, (error: any) => {
					if (typeof error !== "undefined") {
						reject(error);
					}
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	commit() {
		console.log('commit');
		// this.gciSession.commit();
	}

	login(): Promise<void> {
		const requestId = ++this.requestCounter;
		const json = '{' +
			'"request": "login", "id": ' + requestId.toString() +
			', "username": "' + this._login.gs_user + '", ' +
			'"password": "' + this._login.gs_password + '"' +
			'}';
		return new Promise((resolve, reject) => {
			this.requests.set(requestId, [resolve, reject]);
			this.socket.send(json, {}, (ex: any) => {
				if (typeof ex !== "undefined") {
					console.log(ex);
				}
			});
		});
	}

	oopFromExecuteString(input: string): number {
		console.log(`oopFromExecuteString(input: ${input.substring(0, 20)})`);
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

	logout() {
		let json = '{ "request": "logout", "id": 0 }';
		this.socket.send(json, {}, (ex: any) => {
			if (typeof ex !== "undefined") {
				console.log(ex);
			}
		});
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
