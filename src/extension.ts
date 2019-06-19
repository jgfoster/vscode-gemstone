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

export function activate(context: vscode.ExtensionContext) {
	// console.log(context.globalStoragePath);
	if (!isValidSetup()) { return; }
	createOutputChannel();
	createViewForLoginList();
	createViewForSessionList();
	createStatusBarItem(context);
	createLoginCommandHandler(context);
	createLogoutCommandHandler(context);
	createDisplayItCommandHandler(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log('deactivate');
}

// DisplayIt command handler
const createDisplayItCommandHandler = (context: vscode.ExtensionContext) => {
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
			const result = ' ' + sessions[sessionId - 1].stringFromExecuteString('[' + text + '] value printString');
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
	const disposable = vscode.commands.registerTextEditorCommand('gemstone.displayIt', displayIt);
	context.subscriptions.push(disposable);
};

// Login command handler
const createLoginCommandHandler = (context: vscode.ExtensionContext) => {
	const disposable = vscode.commands.registerCommand('gemstone.login', (login: Login) => {
		let session;
		try {
			session = new Session(login, sessions.length + 1);
		} catch(error) {
			vscode.window.showErrorMessage(error.message);
			console.error(error);
			return;
		}
		sessions.push(session);
		sessionsProvider.refresh();
		outputChannel.appendLine('Login ' + session.description);
		sessionId = session.sessionId;
		statusBarItem.text = `GemStone session: ${sessionId}`;

		// Create filesystem for this session
		const scheme = 'gs' + sessionId.toString() + ':/';
		const gsFileSystem = new GemStoneFS(session);
		context.subscriptions.push(
			vscode.workspace.registerFileSystemProvider(
				scheme.slice(0, -2), 
				gsFileSystem, 
				{ isCaseSensitive: true, isReadonly: true }
			)
		);

		// Add folder to workspace
		const workspaceFolders = vscode.workspace.workspaceFolders;
        const flag = vscode.workspace.updateWorkspaceFolders(
			workspaceFolders ? workspaceFolders.length : 0,
			0, 
			{ 
				uri: vscode.Uri.parse(scheme), 
				name: session.description
			}
		);
		if (!flag) {
			vscode.window.showErrorMessage('Unable to create new workspace folder!');
			return;
		}
	});
	context.subscriptions.push(disposable);
};

// Logout command handler
const createLogoutCommandHandler = (context: vscode.ExtensionContext) => {
	const disposable = vscode.commands.registerCommand('gemstone.logout', (session: Session) => {
		outputChannel.appendLine('Logout ' + session.description);
		session.logout();
		sessionsProvider.refresh();
		if (sessionId === session.sessionId) {
			sessionId = 0;
			statusBarItem.text = 'GemStone session: none';
		}

		// remove folder from workspace
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders) {
			const i = workspaceFolders.findIndex(each => 
				each.uri.toString() === 'gs' + session.sessionId.toString() + ':/');
			if (i > 0) {
				vscode.workspace.updateWorkspaceFolders(i, 1);
			}
		}
	});
	context.subscriptions.push(disposable);
};

// Output Channel to show information
const createOutputChannel = () => {
	outputChannel = vscode.window.createOutputChannel('GemStone');
	outputChannel.appendLine('Activated GemStone extension');
};

// Status bar item
const createStatusBarItem = (context: vscode.ExtensionContext) => {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'GemStone session: none';
	statusBarItem.command = 'gemstone.showSessionId';
	statusBarItem.show();
	context.subscriptions.push(vscode.commands.registerCommand('gemstone.showSessionId', () => {
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

const isValidSetup = (): boolean => {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage("GemStone extension requires a workspace!");
		return false;
	}
	for (let i = workspaceFolders.length - 1; i >= 0; i--) {
		if (workspaceFolders[i].uri.toString().match(/^gs[0-9]+\:\//g)) {
			vscode.workspace.updateWorkspaceFolders(i, 1);
		}
	}
	if (workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("GemStone extension requires at least one folder in the workspace!");
		return false;
	}
	return true;
};
