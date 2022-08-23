/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

import * as vscode from 'vscode';

import { LoginsProvider } from './view/LoginProvider';
import { Login } from './model/Login';
import { SessionsProvider } from './view/SessionProvider';
import { Session } from './model/Session';
import { GsFileSystemProvider } from './view/GsFileSystemProvider';

let context: vscode.ExtensionContext;
const loginsProvider = new LoginsProvider();
let outputChannel: vscode.OutputChannel;
let selectedSession: Session | null = null;
const sessions: Session[] = [];
const sessionsProvider = new SessionsProvider(sessions);
let sessionsTreeView: vscode.TreeView<Session>;
const statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

// this method is called when the user selects the extension
export function activate(aContext: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	console.log('activate');
	context = aContext;

	// GemStone needs a workspace and a folder to support a file system
	if (!isValidSetup()) { return; }

	// create various UI components used by this extension
	createOutputChannel();
	createViewForLoginList();
	createViewForSessionList();
	createStatusBarItem(aContext);
	createCommands(aContext);
}

async function closeEditors(session: Session): Promise<void> {
	let myFiles: vscode.Uri[] = [];
	vscode.workspace.textDocuments.forEach((each) => {
		if (each.uri.scheme === session.fsScheme()) {
			myFiles.push(each.uri);
		}
	});
	for (let i = 0; i < myFiles.length; ++i) {
		const each = myFiles[i];
		while (vscode.window.activeTextEditor?.document.uri != each) {
			await vscode.commands.executeCommand('workbench.action.nextEditor');
		}
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	}
}

function createCommands(aContext: vscode.ExtensionContext) {
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
	aContext.subscriptions.push(vscode.commands.registerCommand(
		'gemstone.openDocument',
		(content: string) => {
			vscode.workspace.openTextDocument({ content });
		}
	)); // openDocument

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
	updateStatusBar();
	statusBarItem.show();
}

async function createViewForLoginList(): Promise<void> {
	vscode.window.registerTreeDataProvider('gemstone-logins', loginsProvider);
}

async function createViewForSessionList(): Promise<void> {
	sessionsTreeView = vscode.window.createTreeView('gemstone-sessions', { treeDataProvider: sessionsProvider });
	sessionsTreeView.onDidChangeSelection(onSessionSelected);
}

export async function deactivate() {
	// The extensions run in a separate process, called the extension host process.
	// When closing a window, the renderer process goes down immediately.
	// The extension host process has at most 5 seconds to shut down, after which it will exit.
	// The vscode API will be unreliable at deactivation time, especially parts that are serviced 
	//		by the renderer process (like e.g. openTextDocument, etc.)
	// https://github.com/Microsoft/vscode/issues/47881

	const promises: Thenable<void>[] = [];
	for (const session of sessions) {
		promises.push(logoutHandler(session));
	}
	return Promise.all(promises).then(() => undefined);
}

// evaluate a Smalltalk expression found in a TextEditor and insert the value as a string
async function displayIt(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, args: any[]) {
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
		const result = ' ' + await selectedSession.stringFromExecute(text);
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
			const session = new Session(login, nextSessionId());
			await session.connect();
			await session.getVersion();
			await session.login();
			await session.registerJadeServer();
			selectedSession = session;
			sessions.push(session);
			sessionsProvider.refresh(); // show new session
			sessionsTreeView.reveal(session, { focus: true, select: true }); // select new session
			updateStatusBar();

			// Create filesystem for this session
			progress.report({ message: 'Add SymbolDictionaries to Explorer' });
			const scheme = session.fsScheme();
			const fsProvider = await GsFileSystemProvider.forSession(session);
			const options = { isCaseSensitive: true, isReadonly: false };
			const subscription = vscode.workspace.registerFileSystemProvider(
				scheme,
				fsProvider,
				options
			);
			session.subscriptions.push(subscription);

			outputChannel.appendLine('Login ' + session.description);
			resolve();
		} catch (error: any) {
			console.error('doLogin - error - ', error);
			reject(error);
		}
	});
}

// on activation check to see if we have a workspace and a folder
// "If the first workspace folder is added, removed or changed, the currently executing extensions 
// (including the one that called this method) will be terminated and restarted" 
// [updateWorkspaceFolders()](https://code.visualstudio.com/api/references/vscode-api#workspace.updateWorkspaceFolders), 
// and we can't have that!
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
		} else {
			console.log('deleted left-over folders');
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
				} catch (error: any) {
					vscode.window.showErrorMessage(error.message);
				}
			}
		});
}

async function logoutHandler(session: Session): Promise<void> {
	outputChannel.appendLine('Logout ' + session.description);
	await closeEditors(session);
	await removeFolders(session);
	removeSession(session);

	await session.logout();
	sessionsProvider.refresh();

	if (selectedSession === session) {
		if (sessions.length === 0) {
			selectedSession = null;
		} else {
			selectedSession = sessions[0];
			await sessionsTreeView.reveal(selectedSession, { select: true, focus: true });
		}
		sessionsProvider.refresh();
		updateStatusBar();
	}
}

function nextSessionId(): number {
	let nextSessionId = 1;
	while (true) {
		let isAvailable = true;
		sessions.forEach((each) => {
			if (each.sessionId === nextSessionId) {
				isAvailable = false;
				return;
			}
		});
		if (isAvailable) {
			return nextSessionId;
		}
		++nextSessionId;
	}
}

function onSessionSelected(event: vscode.TreeViewSelectionChangeEvent<Session>): void {
	// this seems to work for manual selections but not for automatic selections
	const sessions: Session[] = event.selection;
	if (sessions.length === 0) {
		selectedSession = null;
		updateStatusBar();
	} else {
		selectedSession = sessions[0];
		updateStatusBar();
	}
}

async function removeFolders(session: Session): Promise<void> {
	// remove this session's SymbolDictionaries (folders) from the workspace
	const prefix = session!.fsScheme() + ':/';
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

function removeSession(session: Session): void {
	sessions.forEach((item, index, array) => { if (item === session) array.splice(index, 1); });
}

function updateStatusBar(): void {
	statusBarItem.text = `GemStone session: ${selectedSession ? selectedSession?.sessionId : 'none'}`;
}
