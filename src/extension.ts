// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {Md5} from 'ts-md5';

import { Session } from './model/Session';
import { Disposable } from 'vscode-languageclient';

// context gets the language server as a subscription
let context: vscode.ExtensionContext;
let outputChannel: vscode.OutputChannel;
let session: Session | null = null;
let login: any;
const statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
let watcher: vscode.FileSystemWatcher | null = null;
let diagnosticCollection: vscode.DiagnosticCollection;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(aContext: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	console.log('activate');
	context = aContext;

	// GemStone needs a workspace and a folder to support a file system
	if (!isValidSetup()) { return; }

	// create various UI components used by this extension
	createOutputChannel();
	registerCommandHandlers(aContext);
	createStatusBarItem(aContext);
	vscode.commands.executeCommand('setContext', 'gemstone.isLoggedIn', false);

	diagnosticCollection = vscode.languages.createDiagnosticCollection('gs');
	aContext.subscriptions.push(diagnosticCollection);
}

// https://code.visualstudio.com/api/references/vscode-api#OutputChannel
async function createOutputChannel(): Promise<void> {
	outputChannel = vscode.window.createOutputChannel('GemStone');
	outputChannel.appendLine('Activated GemStone extension');
}

async function createStatusBarItem(aContext: vscode.ExtensionContext): Promise<void> {
	statusBarItem.command ='gemstone.login';
	statusBarItem.text = 'Login';
	statusBarItem.show();
}

// This method is called when your extension is deactivated
export function deactivate() {
	logoutHandler();
	context.subscriptions.forEach((each: Disposable) => each.dispose());  // diagnostics
}

// evaluate a Smalltalk expression found in a TextEditor and insert the value as a string
async function displayIt(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, args: any[]) {
	if (!session) {
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
		const result = ' ' + await session.stringFromExecute(text);
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
			session = new Session(login);
			await session.connect();
			await session.getVersion();
			await session.login(context);
			await session.registerJadeServer();
			statusBarItem.command ='gemstone.logout';
			statusBarItem.text = 'Logout';
			vscode.commands.executeCommand('setContext', 'gemstone.isLoggedIn', true);
			await synchronizeFolders(progress);
			setUpFileSystemWatcher();
			outputChannel.appendLine('Successful login');
			resolve();
		} catch (error: any) {
			console.error('doLogin - error - ', error);
			reject(error);
		}
	});
}

function fileChanged(uri: vscode.Uri): void {
	console.log(`fileChanged(${uri})`);
	diagnosticCollection.clear();
	const issues: vscode.Diagnostic[] = [];
	const range = new vscode.Range(22, 5, 22, 10);
	issues.push(new vscode.Diagnostic(range, "message", vscode.DiagnosticSeverity.Error));
	diagnosticCollection.set(uri, issues);
}

function fileCreated(uri: vscode.Uri): void {
	console.log(`fileCreated(${uri})`);
}

function fileDeleted(uri: vscode.Uri): void {
	console.log(`fileDeleted(${uri})`);
}

async function isSynchronizeFileNeeded(uri: vscode.Uri, each: any): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.type !== vscode.FileType.File) {
			vscode.workspace.fs.delete(uri);
			return true;
		}
		if (stat.size !== each.size) {
			return true;
		}
		const bytes = await vscode.workspace.fs.readFile(uri);
		const md5 = new Md5();
		md5.appendByteArray(bytes);
		const hash = md5.end();
		if (hash != each.md5) {
			return true;
		}
	} catch (error) {
		return true;
	}
	return false;
}

// on activation check to see if we have a workspace and a folder
function isValidSetup(): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage("GemStone extension requires a workspace!");
		return false;
	}
	if (workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("GemStone extension requires at least one folder in the workspace!");
		return false;
	}
	return true;
}

async function loginHandler(): Promise<void> {
	if (session !== null) {
		vscode.window.showErrorMessage("Already logged in!");
		return;
	}
	login = vscode.workspace.getConfiguration('gemstone.login');
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Starting login...',
			cancellable: false
		},
		async (progress, _) => {
			let password: string | null | undefined = login.gemPassword;
			if (!password) {
				await vscode.window.showInputBox({
					ignoreFocusOut: true,
					password: true,
					placeHolder: 'swordfish',
					prompt: 'Enter the GemStone password for ' + login.gemUser,
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
					await doLogin({ ...login, 'gemPassword': password }, progress);
				} catch (error: any) {
					vscode.window.showErrorMessage(error.message);
				}
			}
		});
}

async function logoutHandler(): Promise<void> {
	outputChannel.appendLine('Logout');
	await session!.logout();
	session = null;
	statusBarItem.command ='gemstone.login';
	statusBarItem.text = 'Login';
	vscode.commands.executeCommand('setContext', 'gemstone.isLoggedIn', false);
	watcher!.dispose();
	watcher = null;
}

function registerCommandHandlers(aContext: vscode.ExtensionContext) {
	// The commands have been defined in the package.json file ("contributes"/"commands")
	// Now provide the implementations of the commands with registerCommand
	// The commandId parameter must match the command field in package.json
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.login',
		loginHandler
	)); // login
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.logout',
		logoutHandler
	)); // logout
	aContext.subscriptions.push(vscode.commands.registerTextEditorCommand(
		'gemstone.displayIt',
		displayIt
	)); // displayIt
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.settings',
		settings
	)); // displayIt
}

async function settings(): Promise<void> {
	vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'GemStone');
}

function setUpFileSystemWatcher(): void {
	watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], '**'));
	watcher.onDidChange(uri => { fileChanged(uri); }); // listen to files being changed
	watcher.onDidCreate(uri => { fileCreated(uri); }); // listen to files/folders being created
	watcher.onDidDelete(uri => { fileDeleted(uri); }); // listen to files/folders getting deleted
}

async function synchronizeFile(uri: vscode.Uri, each: any): Promise<void> {
	if (!(await isSynchronizeFileNeeded(uri, each))) {
		return;
	}
	const string = await session!.getClass(each.oop);
	const bytes = Buffer.from(string);
	await vscode.workspace.fs.writeFile(uri, bytes);
}

async function synchronizeFolder(parent: vscode.Uri, each: any): Promise<void> {
	const folder = vscode.Uri.joinPath(parent, each.name);
	try {
		const stat = await vscode.workspace.fs.stat(folder);
		if (stat.type !== vscode.FileType.Directory) {
			vscode.workspace.fs.delete(folder);
			vscode.workspace.fs.createDirectory(folder);
		}
	} catch (error) {
		vscode.workspace.fs.createDirectory(folder);
	};
	let classes: any = null;
	try {
		classes = await session!.getClassesInDictionary(each.oop);
		for (const each of classes) {
			const fileUri = vscode.Uri.joinPath(folder, each.name);
			synchronizeFile(fileUri, each);
		}
	} catch (error) {
		console.log(error);
		return;
	}
}

async function synchronizeFolders(progress: any): Promise<void> {
	// Synchronize files
	progress.report({ message: 'Synchronize SymbolDictionaries' });
	let symbolList: any;
	try {
		symbolList = await session!.getSymbolList();
	} catch (error) {
		console.log(error);
		return;
	}
	const root: vscode.Uri = vscode.workspace.workspaceFolders![0].uri;
	for (const each of symbolList) {
		await synchronizeFolder(root, each);
	}
	let entries = await vscode.workspace.fs.readDirectory(root);
	const regexp = new RegExp('^[0-9]*-.');
	entries = entries.filter((each) => { return regexp.test(each[0]) && each[1] === vscode.FileType.Directory; });
	const names = entries.map((each) => { return each[0]; });
	for (const each of names) {
		const validFlag = symbolList.some((dict: any) => { return dict.name == each; });
		if (!validFlag) {
			const uri = vscode.Uri.joinPath(root, each);
			await vscode.workspace.fs.delete(uri, { recursive: true });
		}
	}
	context.workspaceState.update('gemstone.symbolList', symbolList);
}
