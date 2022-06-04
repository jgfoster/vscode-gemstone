/*
 *	Session.ts
 */

import * as path from 'path';
import * as vscode from 'vscode';

import {Login} from './Login';

const WebSocket = require('ws');
import JadeServer from './JadeServer';
import exp = require('constants');
import {SymbolDictionary} from './SymbolDictionary';
import {privateEncrypt} from 'crypto';

let sessionCounter: number = 0;

export class Session extends vscode.TreeItem {
  isLoggedIn: boolean = false;
  private jadeServer: string = '';
  requestCounter: number = 0;
  requests: Map<number, Array<Function>> = new Map;
  sessionId: number;
  socket: typeof WebSocket;
  version: string = '';
  constructor(private _login: Login) {
    super(_login.label, vscode.TreeItemCollapsibleState.None);
    this.sessionId = ++sessionCounter;
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
      } else if (value instanceof Array) {
        json = json + '[';
        comma = '';
        value.forEach((value1: any) => {
          json = json + comma + value.toString();
          comma = ', ';
        });
        json = json + ']';
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
          if (typeof error !== 'undefined') {
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
        this.socket = new WebSocket(`ws://${this._login.gem_host}:${
            this._login.gem_port}/webSocket.gs`);
      } catch (error) {
        this.requests.clear();
        reject(error);
      }
      this.socket.on('close', (event: any) => {
        this.handleClose(event);
      });
      this.socket.on('error', (event: any) => {
        this.handleError(event);
      });
      this.socket.on('message', (event: any) => {
        this.handleMessage(event);
      });
      this.socket.on('open', (_: any) => {
        this.requests.delete(0);
        resolve();
      });
    });
  }

  async getSymbolList(): Promise<Array<SymbolDictionary>> {
    return new Promise(async (resolve, reject) => {
      // obtain list of SymbolDictionary instances
      try {
        const myString =
            await this.stringFromPerform('getSymbolList', [], 1024);
        const array = new Array;
        JSON.parse(myString).list.forEach(
            (element: {oop: number, name: string, size: number}) => {
              array.push(new SymbolDictionary(
                  element.oop.toString(), element.name, element.size));
            });
        resolve(array);
      } catch (ex: any) {
        reject(ex);
      }
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

  async getVersion(): Promise<void> {
    const json = new Map;
    json.set('request', 'getGciVersion');
    try {
      const response = await this.send(json);
      this.version = response.version.split(' ')[0];
      Promise.resolve();
    } catch (error) {
      Promise.reject(error);
    }
  }

  commit() {
    console.log('commit');
    // this.gciSession.commit();
  }

  async login(): Promise<Map<string, any>> {
    const json = new Map;
    json.set('request', 'login');
    json.set('username', this._login.gs_user);
    json.set('password', this._login.gs_password);
    return this.send(json);
  }

  async logout(): Promise<Map<string, any>> {
    const json = new Map;
    json.set('request', 'logout');
    return this.send(json);
  }

  async oopFromExecuteString(input: string): Promise<string> {
    const myString = input.replace(/\"/g, '\\\"');
    return new Promise(async (resolve, reject) => {
      const json = new Map;
      json.set('request', 'execute');
      json.set('string', myString);
      try {
        await this.send(json);
        json.clear();
        json.set('request', 'nbResult');
        const obj = await this.send(json);
        resolve(obj.oop);
      } catch (error) {
        reject(error);
      }
    });
  }

  async registerJadeServer(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this.jadeServer = await this.oopFromExecuteString(JadeServer);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  stringFromExecute(input: string, size: number = 1024): string {
    console.log('stringFromExecute(input: string, size: number = 1024)');
    // const myString = '| x | x := [' + input + '] value. ' +
    // 	'x size > ' + (size - 4).toString() +
    // 	' ifTrue: [x := (x copyFrom: 1 to: ' + (size - 4).toString() + ') ,
    // \'...\']. x'; return this.gciSession.executeFetchBytes(myString, size);
    return 'nil';
  }

  async stringFromPerform(
      selector: string, oopArray: number[],
      expectedSize: number): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const json: Map<string, any> = new Map;
      json.set('receiver', this.jadeServer);
      json.set('args', oopArray);
      json.set('request', 'performFetchBytes');
      json.set('selector', selector);
      json.set('maxSize', expectedSize);
      // console.log('stringFromPerform', selector, oopArray, expectedSize,
      // json);
      try {
        const obj = await this.send(json);
        resolve(obj.result);
      } catch (error) {
        reject(error);
      }
    });
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
  };
}
