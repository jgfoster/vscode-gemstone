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
import { ClassesProvider, GsClass } from './ClassProvider';
import { MethodsProvider } from './MethodProvider';
import { GemStoneFS } from './fileSystemProvider';
// import fs = require('fs');

const classesProvider = new ClassesProvider();
let classesTreeView: vscode.TreeView<GsClass>;
const loginsProvider = new LoginsProvider();
const methodsProvider = new MethodsProvider();
let outputChannel: vscode.OutputChannel;
let selectedClass: GsClass | null = null;
let selectedSession: Session | null = null;
const statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
const sessions: Session[] = [];
const sessionsProvider = new SessionsProvider(sessions);
let sessionsTreeView: vscode.TreeView<Session>;

let context: vscode.ExtensionContext;

// this method is called when your extension is activated
// your extension is activated when the user selects the extension
export function activate(aContext: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
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
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.login',
		loginHandler
	));
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.logout',
		logoutHandler
	));
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.selectNamespace',
		selectNamespaceHandler
	));
	aContext.subscriptions.push(vscode.commands.registerTextEditorCommand(
		'gemstone.displayIt',
		displayIt
	));
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.displayClassFinder',
		() => classesProvider.displayClassFinder()
	));
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
	statusBarItem.text = 'GemStone session: none';
	statusBarItem.command = 'gemstone.showSessionId';
	statusBarItem.show();
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.showSessionId', () => {
		vscode.window.showInformationMessage(`GemStone session: ${selectedSession ? selectedSession.sessionId : 'none'}`);
	}));
}

async function createViewForClassList(): Promise<void> {
	classesTreeView = vscode.window.createTreeView('gemstone-classes', { treeDataProvider: classesProvider });
	classesTreeView.onDidChangeSelection(onClassSelected);
	vscode.commands.registerCommand('gemstone-classes.refreshEntry', () => {
		classesProvider.refresh();
	});
}

async function createViewForMethodList(): Promise<void> {
	vscode.window.registerTreeDataProvider('gemstone-methods', methodsProvider);
}

async function createViewForLoginList(): Promise<void> {
	vscode.window.registerTreeDataProvider('gemstone-logins', loginsProvider);
}

async function createViewForSessionList(): Promise<void> {
	sessionsTreeView = vscode.window.createTreeView('gemstone-sessions', { treeDataProvider: sessionsProvider });
	sessionsTreeView.onDidChangeSelection(onSessionSelected);
	vscode.commands.registerCommand('gemstone-sessions.refreshEntry', () => {
		sessionsProvider.refresh();
	});
}

// evaluate a Smalltalk expression found in a TextEditor and insert the value as a string
function displayIt(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, args: any[]) {
	if (!selectedSession) {
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
		const result = ' ' + selectedSession.stringFromExecute('[' + text + '] value printString');
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

async function doLogin(login: any, progress: any): Promise<void> {
	return new Promise(async (resolve, reject) => {
		try {
			const session = new Session(login);
			await session.connect();
			await session.getVersion();
			await session.login();
			await session.registerJadeServer();
			sessions.push(session);
			sessionsProvider.refresh(); // show new session
			sessionsTreeView.reveal(session, { focus: true, select: true }); // select new session
			outputChannel.appendLine('Login ' + session.description);
			resolve();
		} catch (error: any) {
			vscode.window.showErrorMessage(error.message);
			reject(error);
		}
	});
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

async function loginHandler(login: Login): Promise<void> {
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Starting login...',
			cancellable: false
		},
		async (progress, _) => {
			let password: string | null | undefined = login.gs_password;
			if (!password) {
				await vscode.window.showInputBox({
					ignoreFocusOut: true,
					password: true,
					placeHolder: 'swordfish',
					prompt: 'Enter the GemStone password for ' + login.gs_user,
					value: 'swordfish'
				}).then(
					(value) => {
						password = value;
					},
					(_) => { }
				);
			}
			if (password) {
				try {
					await doLogin({ ...login, 'gs_password': password }, progress);
				} catch (_) { }
			}
		});
}

async function logoutHandler(session: Session): Promise<void> {
	return new Promise(async (resolve, reject) => {
		outputChannel.appendLine('Logout ' + session.description);
		await session.logout();
		sessionsProvider.refresh();
		// handle log out for classesProvider + methodsProvider
		if (selectedSession === session) {
			selectedSession = null;
			statusBarItem.text = 'GemStone session: none';
		}
	});
}

function onLogin(session: Session, progress: any): void {
	classesProvider.setSession(session);
	methodsProvider.setSession(session);
	statusBarItem.text = `GemStone session: ${selectedSession!.sessionId}`;

	// Create filesystem for this session
	progress.report({ message: 'Add SymbolDictionaries to Explorer' });
	// context.subscriptions.push(
	// 	vscode.workspace.registerFileSystemProvider(
	// 		'gs' + currentSession!.sessionId.toString(),
	// 		new GemStoneFS(session),
	// 		{ isCaseSensitive: true, isReadonly: false }
	// 	)
	// );
}

function onLogout(session: Session): void {
	console.log('onLogout()');
	sessionsProvider.refresh();
	// remove this session's SymbolDictionaries (folders) from the workspace
	const prefix = 'gs' + selectedSession!.sessionId.toString() + ':/';
	const workspaceFolders = vscode.workspace.workspaceFolders || [];
	let start, end;
	for (let i = 0; i < workspaceFolders.length; i++) {
		if (workspaceFolders[i].uri.toString().startsWith(prefix)) {
			if (!start) {
				start = i;
				end = i;
			} else {
				end = i;
			}
		}
	}
	if (start && end) {
		const flag = vscode.workspace.updateWorkspaceFolders(start, end - start + 1);
		if (!flag) {
			console.log('Unable to remove workspace folders!');
			vscode.window.showErrorMessage('Unable to remove workspace folders!');
		}
	}
}

async function onClassSelected(event: vscode.TreeViewSelectionChangeEvent<GsClass>): Promise<void> {
	const selections = event.selection;
	if (selections.length === 0) {
		selectedClass = null;
	} else {
		selectedClass = selections[0];
	}
	return new Promise(async (resolve, _) => {

	});
}

async function onSessionSelected(event: vscode.TreeViewSelectionChangeEvent<Session>): Promise<void> {
	const selections = event.selection;
	if (selections.length === 0) {
		selectedSession = null;
		statusBarItem.text = 'GemStone session: none';
	} else {
		selectedSession = selections[0];
		statusBarItem.text = `GemStone session: ${selectedSession?.sessionId}`;
	}
	return new Promise(async (resolve, _) => {
		try {
			await classesProvider.setSession(selectedSession);
		} catch (error: any) {
			vscode.window.showErrorMessage(error.message);
		}
		resolve();
	});
}

async function selectNamespaceHandler(): Promise<void> {
	if (selectedSession) {
		var symbolDictionariesList = classesProvider.getSymbolDictionaryNames();
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
