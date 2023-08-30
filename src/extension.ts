// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Session } from './model/Session';

// context gets the language server as a subscription
let context: vscode.ExtensionContext;
let outputChannel: vscode.OutputChannel;
let session: Session | null = null;
let login: any;
const statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(aContext: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	console.log('activate');
	context = aContext;

	login = vscode.workspace.getConfiguration('gemstone.login');
	// GemStone needs a workspace and a folder to support a file system
	if (!isValidSetup()) { return; }

	// create various UI components used by this extension
	createOutputChannel();
	registerCommandHandlers(aContext);
	createStatusBarItem(aContext);
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

			// Create filesystem for this session
			progress.report({ message: 'Add SymbolDictionaries to Explorer' });
				
			outputChannel.appendLine('Successful login');
			resolve();
		} catch (error: any) {
			console.error('doLogin - error - ', error);
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
	if (workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("GemStone extension requires at least one folder in the workspace!");
		return false;
	}
	return true;
}

async function loginHandler(): Promise<void> {
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
					await doLogin({ ...login, 'gsPassword': password }, progress);
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
}
