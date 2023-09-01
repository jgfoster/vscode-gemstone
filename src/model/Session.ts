/*
 *	Session.ts
 */

import * as vscode from 'vscode';
import WebSocket = require('ws');

import JadeServer from './JadeServer';
import { LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo, integer } from 'vscode-languageclient/node';
import stream = require('stream');

export class Session {
  isLoggedIn: boolean = false;
  private jadeServer: string = '';
  requestCounter: number = 0;
  requests: Map<number, Array<Function>> = new Map;
  private session: string = '';
  socket: WebSocket | null = null;
  subscriptions: vscode.Disposable[] = [];
  version: string = '';
  
  constructor(private _login: any) {  }

  private send(obj: any): Promise<any> {
    const requestId = ++this.requestCounter;
    obj.id = requestId;
    return new Promise((resolve, reject) => {
      this.requests.set(requestId, [resolve, reject]);
      try {
        this.socket!.send(JSON.stringify(obj), {}, (error: any) => {
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
        this.socket = new WebSocket(`ws://${this._login.gemHost}:${this._login.gemPort}/webSocket.gs`);
      } catch (error) {
        this.requests.clear();
        reject(error);
      }
      this.socket!.on('close', (event: any) => {
        this.handleClose(event);
      });
      this.socket!.on('error', (event: any) => {
        this.handleError(event);
      });
      this.socket!.on('message', (event: any) => {
        this.handleMessage(event);
      });
      this.socket!.on('open', (_: any) => {
        this.requests.delete(0);
        resolve();
      });
    });
  }

  async getClass(oop: number): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        let result = '';
        let chunkNumber = 1;
        do {
          const myString = await this.stringFromPerform('getClass:chunk:', [oop, chunkNumber * 8 + 2]);
          result = result + myString;
          chunkNumber = chunkNumber + 1;
        } while (result.length % 25000 == 0); 
        resolve(result);
      } catch (ex: any) {
        reject(ex);
      }
    });
  }

  async getClassesInDictionary(oop: number): Promise<Array<any>> {
    return new Promise(async (resolve, reject) => {
      try {
        let result = '';
        let chunkNumber = 1;
        do {
          const myString = await this.stringFromPerform('getClassesInDictionary:chunk:', [oop, chunkNumber * 8 + 2]);
          result = result + myString;
          chunkNumber = chunkNumber + 1;
        } while (result.length % 25000 == 0); 
        resolve(JSON.parse(result).list);
      } catch (ex: any) {
        reject(ex);
      }
    });
  }

  async getSymbolList(): Promise<Array<any>> {
    return new Promise(async (resolve, reject) => {
      try {
        const myString = await this.stringFromPerform('getSymbolList', [], 1024);
        resolve(JSON.parse(myString).list);
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
    console.log(`error - ${event}`);
    this.isLoggedIn = false;
    this.requests.forEach(element => {
      element[1](event);
    });
    this.requests.clear();
  }

  handleMessage(event: any): void {
    // maximum payload size < 60 KB; we use 25 KB to be safe (bytes are sent as hex so double the size)!
    const myString = String.fromCharCode(...event);
    const obj = JSON.parse(myString);
    const id = obj['_id'];
    const functions = this.requests.get(id);
    this.requests.delete(id);
    console.log(`${obj._request} took ${obj._time} ms`);
    if (obj['type'] === 'error') {
      functions![1](obj);
    } else {
      if (obj['request'] === 'login') {
        this.isLoggedIn = true;
      } else if (obj['request'] === 'logout') {
        this.isLoggedIn = false;
        this.socket!.close();
        this.socket = null;
      }
      functions![0](obj);
    }
  }

  async getVersion(): Promise<void> {
    try {
      const response = await this.send({ 'request': 'getGciVersion' });
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

  async login(aContext: vscode.ExtensionContext): Promise<void> {
    let result = await this.send({
      'request': 'login',
      'username': this._login.gemUser,
      'password': this._login.gemPassword
    });
    this.session = result['result'];
  }

  async logout(): Promise<void> {
    await this.send({ 'session': this.session, 'request': 'logout' });  // send logout request to Gem
    this.subscriptions.forEach((each) => each.dispose());  // dispose of file system provider
  }

  async oopFromExecuteString(input: string): Promise<string> {
    const myString = input.replace(/\"/g, '\\\"');
    return new Promise(async (resolve, reject) => {
      try {
        let result = await this.send({ 'session': this.session, 'request': 'execute', 'string': myString });
        const obj = await this.send({ 'session': this.session, 'request': 'nbResult' });
        resolve(obj.oop);
      } catch (error) {
        reject(error);
      }
    });
  }

  async registerJadeServer(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await this.oopFromExecuteString(JadeServer);
        console.log(result);
        this.jadeServer = result;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async stringFromExecute(input: string, size: number = 1024): Promise<string> {
    const myString = '| x | x := [' + input + '] value printString. ' +
      'x size > ' + (size - 4).toString() +
      ' ifTrue: [x := (x copyFrom: 1 to: ' + (size - 4).toString() + ') , \'...\']. x';
    return new Promise(async (resolve, reject) => {
      try {
        let result = await this.send({ 'session': this.session, 'request': 'executeFetchBytes', 'string': myString, 'size': size });
        resolve(result.result);
      } catch (e: any) {
        reject(e);
      }
    });
  }

  async stringFromPerform(
    selector: string, oopArray: number[],
    expectedSize: number = 25000): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const obj = await this.send({
          'session': this.session, 
          'receiver': this.jadeServer,
          'args': oopArray,
          'request': 'performFetchBytes',
          'selector': selector,
          'maxSize': expectedSize
        });
        if (obj.type === 'ByteArray') {
          resolve(Buffer.from(obj.result, 'base64').toString());
        } else {
          resolve(obj.result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}
