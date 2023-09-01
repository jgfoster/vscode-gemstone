/*
 *	Session.ts
 *
 * Language Server Protocol client influenced by https://github.com/badetitou/vscode-pharo
 * and https://github.com/microsoft/vscode-extension-samples/blob/main/lsp-multi-server-sample/client/src/extension.ts
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

  languageServer: LanguageClient | null = null;
  languageServerBuffer: string = '';
  languageServerPending: number = 0;
  // https://nodejs.dev/en/learn/nodejs-streams#how-to-create-a-readable-stream
  languageServerReader: stream.Readable = new stream.Readable({
    read() {},  // languageServerReader.push(aString);
  });
  languageServerWriter: stream.Writable = new stream.Writable({
    write: (chunk, _encoding, next) => {
      const myChunk: string = chunk.toString();
      if (this.languageServerPending === 0) {
        if (myChunk.startsWith('Content-Length: ')) {
          this.languageServerPending = Number(myChunk.substring(16));
        } else {
          console.log(`Unexpected LSP message: '${myChunk}`);
        }
      } else {
        this.languageServerBuffer = this.languageServerBuffer + myChunk;
        if (this.languageServerBuffer.length === this.languageServerPending) {
          const message = JSON.parse(this.languageServerBuffer);
          if (message.method === 'initialize') {
            console.log('LSP: initialize');
            const result = {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                serverInfo: {
                  name: 'GemStone/S 64 Bit',
                  version: '3.6.5'
                },
                capabilities: {
                  positionEncoding: 'utf-16',
                  textDocumentSync: { openClose: true, change: 2 }
                }
              }
            };
            const resultJson = JSON.stringify(result);
            this.languageServerReader.push(`Content-Length: ${resultJson.length}\r\n\r\n`);
            this.languageServerReader.push(resultJson);
          } else if (message.method === 'initialized') {
            console.log('LSP: initialized');
          } else if (message.method === 'shutdown') {
            console.log('LSP: shutdown');
            const result = {
              jsonrpc: "2.0",
              id: message.id,
              result: null
            };
            const resultJson = JSON.stringify(result);
            this.languageServerReader.push(`Content-Length: ${resultJson.length}\r\n\r\n`);
            this.languageServerReader.push(resultJson);
          } else if (message.method === 'exit') {
            console.log('LSP: exit');
          } else if (message.error) {
            console.log(`LSP Error: ${message.error.code}: '${message.error.message}'`);
          } else {
            console.log(`LSP: '${Object.keys(message)}'?; ${message.method}`);
            console.log(message.params);
          }
          this.languageServerBuffer = '';
          this.languageServerPending = 0;
        }
      }
      next();
    }
  });
  
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

  async createGemStoneLanguageServer(aContext: vscode.ExtensionContext): Promise<void> {
    
    // https://github.com/microsoft/vscode-languageserver-node/blob/2e2658c897fbd20e134076f685da005d173d5e92/client/src/node/main.ts:101
    let streamInfo: StreamInfo = { writer: this.languageServerWriter, reader: this.languageServerReader};
    // https://github.com/microsoft/vscode-languageserver-node/blob/2e2658c897fbd20e134076f685da005d173d5e92/client/src/node/main.ts:126
    let serverOptions: ServerOptions = async () => streamInfo;
  
    let clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'gs', language: 'topaz' },
      ],
      synchronize: {
        // Notify the server about file changes to '.clientrc files contained in the workspace
        // fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
      }
    };
  
    // Create the language client and start the client.

    this.languageServer = new LanguageClient(
      'GemStoneLanguageServer',
      'GemStone Language Server',
      serverOptions,
      clientOptions
    );
    this.languageServer.start();
    aContext.subscriptions.push(this.languageServer);
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
    await this.createGemStoneLanguageServer(aContext);
  }

  async logout(): Promise<void> {
    this.languageServer!.stop();
    this.languageServer = null;
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
