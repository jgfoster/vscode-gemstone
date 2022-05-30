/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Login } from './Login';
const WebSocket = require("ws");

let sessionCounter: number = 0;

export class Session extends vscode.TreeItem {
	isLoggedIn: Boolean = false;
	requestCounter: number = 0;
	requests: Map<number, Array<Function>> = new Map;
	sessionId: number;
	socket: typeof WebSocket;
	version: string = '';
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

	send(map: Map<string, any>): Promise<any> {
		const requestId = ++this.requestCounter;
		map.set('id', requestId);
		let json = '{';
		let comma = '';
		map.forEach((value, key) => {
			json = json + comma + '"' + key + '": ';
			if (typeof value === 'number') {
				json = json + value.toString();
			} else {
				json = json + '"' + value + '"';
			}
			comma = ', ';
		});
		json = json + '}';
		return new Promise((resolve, reject) => {
			this.requests.set(requestId, [resolve, reject]);
			try {
				this.socket.send(json.toString(), {}, (error: any) => {
					if (typeof error !== "undefined") {
						reject(error);
					}
				});
			} catch (error) {
				reject(error);
			}
		});
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
		this.isLoggedIn = false;
		this.requests.forEach(element => {
			element[1]('Connection closed!');
		});
		this.requests.clear();
	}

	handleError(event: any): void {
		this.isLoggedIn = false;
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
			if (obj['request'] === 'login') {
				this.isLoggedIn = true;
			}
			if (obj['request'] === 'logout') {
				this.isLoggedIn = false;
				this.socket.close();
				this.socket = null;
			}
			functions![0](obj);
		}
	}

	async getVersion(): Promise<Map<string, any>> {
		const json = new Map;
		json.set("request", "getGciVersion");
		return this.send(json);
	}

	commit() {
		console.log('commit');
		// this.gciSession.commit();
	}

	async login(): Promise<Map<string, any>> {
		const json = new Map;
		json.set("request", "login");
		json.set("username", this._login.gs_user);
		json.set("password", this._login.gs_password);
		return this.send(json);
	}

	async logout(): Promise<Map<string, any>> {
		const json = new Map;
		json.set("request", "logout");
		return this.send(json);
	}

	oopFromExecuteString(input: string): number {
		console.log(`oopFromExecuteString()`);
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

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
	};
}
