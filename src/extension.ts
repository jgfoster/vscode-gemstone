/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

import * as vscode from 'vscode';
import { LoginsProvider } from './LoginProvider';
import { Login } from './Login';
import { SessionsProvider } from './SessionProvider';
import { Session } from './Session';

export function activate(context: vscode.ExtensionContext) {
	const sessions: Session[] = [];
	const outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('GemStone');
	outputChannel.appendLine('Activated GemStone extension');
	const loginsProvider = new LoginsProvider();
	vscode.window.registerTreeDataProvider('gemstone-logins', loginsProvider);
	const sessionsProvider = new SessionsProvider(sessions);
	vscode.window.registerTreeDataProvider('gemstone-sessions', sessionsProvider);
    vscode.commands.registerCommand("gemstone-sessions.selectSession", (item:vscode.TreeItem) => {
        console.log(item);
    });

	const loginCommand = vscode.commands.registerCommand('gemstone.login', (login: Login) => {
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
	});
	context.subscriptions.push(loginCommand);

	const sessionCommand = vscode.commands.registerCommand('gemstone.logout', (session: Session) => {
		outputChannel.appendLine('Logout ' + session.description);
		session.logout();
		sessionsProvider.refresh();
	});
	context.subscriptions.push(sessionCommand);
}

// this method is called when your extension is deactivated
export function deactivate() {}
