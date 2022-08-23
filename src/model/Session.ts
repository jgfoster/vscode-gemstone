/*
 *	Session.ts
 *
 * Language Server Protocol client influenced by https://github.com/badetitou/vscode-pharo
 * and https://github.com/microsoft/vscode-extension-samples/blob/main/lsp-multi-server-sample/client/src/extension.ts
 */

// import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import WebSocket = require('ws');

import { Login } from './Login';
import JadeServer from './JadeServer';
import { SymbolDictionary } from './SymbolDictionary';
// import { LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo } from 'vscode-languageclient/node';

export class Session extends vscode.TreeItem {
  isLoggedIn: boolean = false;
  // languageServer: LanguageClient | null = null;
  private jadeServer: string = '';
  requestCounter: number = 0;
  requests: Map<number, Array<Function>> = new Map;
  sessionId: number;
  socket: WebSocket | null = null;
  subscriptions: vscode.Disposable[] = [];
  version: string = '';

  constructor(private _login: Login, nextSessionId: number) {
    super(_login.label, vscode.TreeItemCollapsibleState.None);
    this.sessionId = nextSessionId;
    this.tooltip = `${this.sessionId}: ${this._login.tooltip}`;
    this.description = this.tooltip;
  }

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
        this.socket = new WebSocket(`ws://${this._login.gem_host}:${this._login.gem_port}/webSocket.gs`);
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

//   createGemStoneLanguageServer(aContext: vscode.ExtensionContext) {
//     let serverOptions: ServerOptions = () => createServerWithSocket(aContext);
  
//     // Options to control the language client
//     let clientOptions: LanguageClientOptions = {
//       // Register the server for plain text documents
//       documentSelector: [
//         { scheme: 'file', language: 'topaz' },
//       ],
//       synchronize: {
//         // Notify the server about file changes to '.clientrc files contained in the workspace
//         // fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
//       }
//     };
  
//     // Create the language client and start the client.
//     return new LanguageClient(
//       'GemStoneLanguageServer',
//       'GemStone Language Server',
//       serverOptions,
//       clientOptions
//     );
//   }
  
// async createServerWithSocket(aContext: vscode.ExtensionContext): Promise<StreamInfo> {
// 	let socket = await Promise.resolve(getSocket(dls));

// 	let result: StreamInfo = {
// 		writer: socket,
// 		reader: socket
// 	};
// 	return Promise.resolve(result);
// }

// async getSocket(): Promise<net.Socket>  {
// 	return new Promise(function(resolve) {
// 		let socket: net.Socket;
// 		console.log(`Try to connect to port ${data}`);
// 		socket = net.connect({ port: parseInt(data), host: '127.0.0.1' }, () => {
// 			// 'connect' listener.
// 			console.log('connected to server!');
// 			resolve(socket)
// 		});
// 	});
// }

  async getSymbolList(): Promise<Array<SymbolDictionary>> {
    return new Promise(async (resolve, reject) => {
      // obtain list of SymbolDictionary instances
      try {
        const myString =
          await this.stringFromPerform('getSymbolList', [], 1024);
        const array = new Array;
        JSON.parse(myString).list.forEach(
          (element: { oop: number, name: string, size: number }) => {
            array.push(new SymbolDictionary(
              element.oop, element.name, element.size));
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
      }
      if (obj['request'] === 'logout') {
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

  fsScheme(): string {
    return `gs${this.sessionId.toString()}`;
  }

  async login(): Promise<void> {
    await this.send({
      'request': 'login',
      'username': this._login.gs_user,
      'password': this._login.gs_password
    });

    // this.languageServer = createGemStoneLanguageServer(context);
    // this.languageServer.start();
    // context.subscriptions.push(this.languageServer);
  }

  async logout(): Promise<void> {
    await this.send({ 'request': 'logout' });  // send logout request to Gem
    this.subscriptions.forEach((each) => each.dispose());  // dispose of file system provider
  }

  async oopFromExecuteString(input: string): Promise<string> {
    const myString = input.replace(/\"/g, '\\\"');
    return new Promise(async (resolve, reject) => {
      try {
        await this.send({ 'request': 'execute', 'string': myString });
        const obj = await this.send({ 'request': 'nbResult' });
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

  async stringFromExecute(input: string, size: number = 1024): Promise<string> {
    const myString = '| x | x := [' + input + '] value printString. ' +
      'x size > ' + (size - 4).toString() +
      ' ifTrue: [x := (x copyFrom: 1 to: ' + (size - 4).toString() + ') , \'...\']. x';
    return new Promise(async (resolve, reject) => {
      try {
        let result = await this.send({ 'request': 'executeFetchBytes', 'string': myString, 'size': size });
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

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'Login.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'Login.svg')
  };
}
