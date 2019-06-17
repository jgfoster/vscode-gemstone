/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

import * as vscode from 'vscode';
import { LoginsProvider } from './LoginProvider';
import { Login } from './Login';
import { SessionsProvider } from './SessionProvider';
import { Session } from './Session';

var outputChannel: vscode.OutputChannel;
var sessionId: number = 0;
const sessions: Session[] = [];
var sessionsProvider: SessionsProvider;
var statusBarItem: vscode.StatusBarItem;

// DisplayIt command handlerr
const createDisplayItCommandHandler = (context: vscode.ExtensionContext) => {
	const displayIt = (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, args: any[]) => {
		if (sessionId === 0) {
			vscode.window.showErrorMessage('No GemStone session!');
			return;
		}
		var selection: vscode.Selection = textEditor.selection;
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
			const result = ' ' + sessions[sessionId - 1].stringFromExecuteString(text);
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
		var session;
		try {
			session = new Session(login, sessions.length + 1);
		} catch(error) {
			vscode.window.showErrorMessage(typeof error);
			console.error(error);
			return;
		}
		sessions.push(session);
		sessionsProvider.refresh();
		outputChannel.appendLine('Login ' + session.description);
		sessionId = session.sessionId;
		statusBarItem.text = `GemStone session: ${sessionId}`;
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

export function activate(context: vscode.ExtensionContext) {
	createOutputChannel();
	createViewForLoginList();
	createViewForSessionList();
	createStatusBarItem(context);
	createLoginCommandHandler(context);
	createLogoutCommandHandler(context);
	createDisplayItCommandHandler(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}
