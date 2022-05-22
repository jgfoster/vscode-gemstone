/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { LoginsProvider } from './LoginProvider';
import { Login } from './Login';
import { SessionsProvider } from './SessionProvider';
import { Session } from './Session';
import { ClassesProvider } from './ClassProvider';
import { MethodsProvider } from './MethodProvider';
import { GemStoneFS } from './fileSystemProvider';
// import request = require('request');
// import tar = require('tar');
// import fs = require('fs');
// import parser = require('fast-xml-parser');

let outputChannel: vscode.OutputChannel;
let sessionId: number = 0;
const sessions: Session[] = [];
let sessionsProvider: SessionsProvider;
let classesProvider: ClassesProvider;
let methodsProvider: MethodsProvider;
let statusBarItem: vscode.StatusBarItem;
let context: vscode.ExtensionContext;

// this method is called when your extension is activated
// your extension is activated when the user selects the extension
export function activate(aContext: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "gemstone" is now active!');
	context = aContext;

	// GemStone needs a workspace and a folder (I don't recall why!)
	if (!isValidSetup()) { return; }

	// create various UI components used by this extension
	createOutputChannel();
	createViewForLoginList();
	createViewForSessionList();
	createViewForClassList();
	createViewForMethodList();
	createStatusBarItem(aContext);

	// The commands have been defined in the package.json file ("contributes"/"commands")
	// Now provide the implementations of the commands with registerCommand
	// The commandId parameter must match the command field in package.json
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.login', loginHandler));
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.logout', logoutHandler));
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.selectNamespace', selectNamespaceHandler));
	aContext.subscriptions.push(vscode.commands.registerTextEditorCommand('gemstone.displayIt', displayIt));
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.displayClassFinder', () => classesProvider.displayClassFinder()));
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.fetchMethods',
		(classObj: any) => {
			methodsProvider.getMethodsFor(classObj);
			methodsProvider.refresh();
		}
	));
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.openDocument',
		(content: string) => {
			vscode.workspace.openTextDocument({ content })
		}
	));
}

export function deactivate() {
	console.log('deactivate');
}

// https://code.visualstudio.com/api/references/vscode-api#OutputChannel
async function createOutputChannel(): Promise<void> {
	outputChannel = vscode.window.createOutputChannel('GemStone');
	outputChannel.appendLine('Activated GemStone extension');
}

async function createStatusBarItem(aContext: vscode.ExtensionContext): Promise<void> {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'GemStone session: none';
	statusBarItem.command = 'gemstone.showSessionId';
	statusBarItem.show();
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.showSessionId', () => {
		vscode.window.showInformationMessage(`GemStone session: ${sessionId ? sessionId : 'none'}`);
	}));
}

async function createViewForLoginList(): Promise<void> {
	const loginsProvider = new LoginsProvider();
	vscode.window.registerTreeDataProvider('gemstone-logins', loginsProvider);
}

async function createViewForSessionList(): Promise<void> {
	sessionsProvider = new SessionsProvider(sessions);
	vscode.window.registerTreeDataProvider('gemstone-sessions', sessionsProvider);
	vscode.commands.registerCommand("gemstone-sessions.selectSession", (session: Session) => {
		sessionId = session.sessionId;
		statusBarItem.text = `GemStone session: ${sessionId}`;
	});
}

async function createViewForClassList(): Promise<void> {
	classesProvider = new ClassesProvider();
	vscode.window.registerTreeDataProvider('gemstone-classes', classesProvider);
}

async function createViewForMethodList(): Promise<void> {
	methodsProvider = new MethodsProvider();
	vscode.window.registerTreeDataProvider('gemstone-methods', methodsProvider);
}

// evaluate a Smalltalk expression found in a TextEditor and insert the value as a string
function displayIt(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, args: any[]) {
	if (sessionId === 0) {
		vscode.window.showErrorMessage('No GemStone session!');
		return;
	}
	let selection: vscode.Selection = textEditor.selection;
	if (selection.isEmpty) {
		vscode.window.showInformationMessage('Nothing selected! Use <Ctrl>+<L> (<Cmd>+<L> on Mac) to select line.');
		return;
	}
	const text = textEditor.document.getText(selection);
	const count = (text.match(/\'/g) || []).length;
	if (count % 2 === 1) {
		vscode.window.showWarningMessage('Odd number of quote characters means an unterminated string!');
		return;
	}
	try {
		const result = ' ' + sessions[sessionId - 1].stringFromExecute('[' + text + '] value printString');
		textEditor.edit((editBuilder: vscode.TextEditorEdit) => {
			editBuilder.insert(selection.end, result);
		}).then(success => {
			selection = new vscode.Selection(selection.end.line, selection.end.character,
				selection.end.line, selection.end.character + result.length);
			textEditor.selection = selection;
		});
	} catch (e: any) {
		vscode.window.showErrorMessage(e.message);
	}
}

// on activation check to see if we have a workspace and a folder
function isValidSetup(): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage("GemStone extension requires a workspace!");
		return false;
	}
	// look for left-over folders (failure to logout before closing VSCode)
	let start, end;
	for (let i = 0; i < workspaceFolders.length; i++) {
		if (workspaceFolders[i].uri.toString().match(/^gs[0-9]+\:\//g)) {
			if (!start) {
				start = i;
				end = i;
			} else {
				end = i;
			}
		}
	}
	if (start && end) {
		// we delete a contiguous range since it is difficult to delete individual elements
		// https://code.visualstudio.com/api/references/vscode-api#workspace
		const flag = vscode.workspace.updateWorkspaceFolders(start, end - start + 1);
		if (!flag) {
			vscode.window.showErrorMessage('Unable to remove workspace folders!');
		}
	}
	if (workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("GemStone extension requires at least one folder in the workspace!");
		return false;
	}
	return true;
}

function doLogin(login: any, progress: any): void {
	let session;
	try {
		// give each session an incrementing 1-based identifier
		// we need the ID to be stable
		// with other sessions logging out we could consider re-using numbers
		progress.report({ message: 'Call library to initiate login' });
		session = new Session(
			login,
			sessions.length + 1,
			function (session: Session) { console.log("login", session); },
			function (session: Session) { console.log("logout", session); });
	} catch (error: any) {
		vscode.window.showErrorMessage(error.message);
		return;
	}
	sessions.push(session);
	sessionsProvider.refresh();
	// classesProvider.setSession(session);
	// methodsProvider.setSession(session);
	// outputChannel.appendLine('Login ' + session.description);
	// sessionId = session.sessionId;
	// statusBarItem.text = `GemStone session: ${sessionId}`;

	// // Create filesystem for this session
	// progress.report({ message: 'Add SymbolDictionaries to Explorer' });
	// context.subscriptions.push(vscode.workspace.registerFileSystemProvider(
	// 	'gs' + session.sessionId.toString(),
	// 	new GemStoneFS(session),
	// 	{ isCaseSensitive: true, isReadonly: false }
	// )
	// );
}

async function loginHandler(login: Login): Promise<void> {
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Starting login...',
			cancellable: false
		},
		(progress, _) => {
			return new Promise<void>((resolve, reject) => {
				if (login.gs_password) {
					doLogin(login, progress);
					resolve();
				} else {
					vscode.window.showInputBox({
						ignoreFocusOut: true,
						password: true,
						placeHolder: 'swordfish',
						prompt: 'Enter the GemStone password for ' + login.gs_user,
						value: 'swordfish'
					}).then(
						(value) => {
							doLogin({ ...login, 'gs_password': value }, progress);
							resolve();
						},
						(why) => { reject(why); }
					);
				}
			}
			);
		}
	);
}

async function logoutHandler(session: Session): Promise<void> {
	outputChannel.appendLine('Logout ' + session.description);
	session.logout();
	sessionsProvider.refresh();
	// handle log out for classesProvider + methodsProvider
	if (sessionId === session.sessionId) {
		sessionId = 0;
		statusBarItem.text = 'GemStone session: none';
	}
}

async function selectNamespaceHandler(): Promise<void> {
	var session = classesProvider.getSession();
	if (session) {
		var symbolDictionariesList = Object.keys(classesProvider.getSymbolDictionaries());
		vscode.window.showQuickPick(symbolDictionariesList)
			.then((selection: string | undefined) => {
				console.log(selection);
				classesProvider.setSymbolDictionary(selection);
				classesProvider.refresh();
			});
	} else {
		vscode.window.showErrorMessage("No Session Active");
	}
}
