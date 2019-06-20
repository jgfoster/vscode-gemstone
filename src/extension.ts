/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

import * as vscode from 'vscode';
import { LoginsProvider } from './LoginProvider';
import { Login } from './Login';
import { SessionsProvider } from './SessionProvider';
import { Session } from './Session';
import { GemStoneFS } from './fileSystemProvider';

let outputChannel: vscode.OutputChannel;
let sessionId: number = 0;
const sessions: Session[] = [];
let sessionsProvider: SessionsProvider;
let statusBarItem: vscode.StatusBarItem;
let context: vscode.ExtensionContext;

export function activate(aContext: vscode.ExtensionContext) {
	context = aContext;
	if (!isValidSetup()) { return; }
	createOutputChannel();
	createViewForLoginList();
	createViewForSessionList();
	createStatusBarItem(aContext);
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.login', loginHandler));
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.logout', logoutHandler));
	aContext.subscriptions.push(vscode.commands.registerTextEditorCommand('gemstone.displayIt', displayIt));
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log('deactivate');
}

// Output Channel to show information
const createOutputChannel = () => {
	outputChannel = vscode.window.createOutputChannel('GemStone');
	outputChannel.appendLine('Activated GemStone extension');
};

// Status bar item
const createStatusBarItem = (aContext: vscode.ExtensionContext) => {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'GemStone session: none';
	statusBarItem.command = 'gemstone.showSessionId';
	statusBarItem.show();
	aContext.subscriptions.push(vscode.commands.registerCommand('gemstone.showSessionId', () => {
		vscode.window.showInformationMessage(`GemStone session: ${sessionId ? sessionId : 'none'}`);
	}));
};

// View for Login list
const createViewForLoginList = () => {
	const loginsProvider = new LoginsProvider();
	vscode.window.registerTreeDataProvider('gemstone-logins', loginsProvider);
};

// View for Session list
const createViewForSessionList = () => {
	sessionsProvider = new SessionsProvider(sessions);
	vscode.window.registerTreeDataProvider('gemstone-sessions', sessionsProvider);
    vscode.commands.registerCommand("gemstone-sessions.selectSession", (session:Session) => {
		sessionId = session.sessionId;
		statusBarItem.text = `GemStone session: ${sessionId}`;
	});
};

// evaluate a Smalltalk expression found in a TextEditor and insert the value as a string
const displayIt = (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, args: any[]) => {
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
	} catch(e) {
		vscode.window.showErrorMessage(e.message);
		console.error(e.message);
	}
};

// on activation check to see if we have a workspace and a folder
const isValidSetup = (): boolean => {
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
			console.log('Unable to remove workspace folders!');
			vscode.window.showErrorMessage('Unable to remove workspace folders!');
		}
	}
	if (workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("GemStone extension requires at least one folder in the workspace!");
		return false;
	}
	return true;
};

const loginHandler = (login: Login) => {
	let session;
	try {
		// give each session an incrementing 1-based identifier
		// we need the ID to be stable with other sessions logging out
		// we could consider re-using numbers
		session = new Session(login, sessions.length + 1);
	} catch(error) {
		vscode.window.showErrorMessage(error.message);
		console.error(error);
		return;
	}
	sessions.push(session);
	sessionsProvider.refresh();
	outputChannel.appendLine('Login ' + session.description);
	statusBarItem.text = `GemStone session: ${session.sessionId}`;

	// Create filesystem for this session
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider(
			'gs' + session.sessionId.toString(), 
			new GemStoneFS(session), 
			{ isCaseSensitive: true, isReadonly: true }
		)
	);
};

const logoutHandler = (session: Session) => {
	outputChannel.appendLine('Logout ' + session.description);
	session.logout();
	sessionsProvider.refresh();
	if (sessionId === session.sessionId) {
		sessionId = 0;
		statusBarItem.text = 'GemStone session: none';
	}
};
