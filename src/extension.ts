/*
 *  gemstone: GemStone/S 64 Bit IDE
 */

import * as vscode from 'vscode';
import { LoginsProvider } from './LoginProvider';
import { Login } from './Login';
import { SessionsProvider } from './SessionProvider';
import { Session } from './Session';
const { GciSession } = require('gci-js');

const config = vscode.workspace.getConfiguration('gemstone');
var sessions: Session[] = [];

export function activate(context: vscode.ExtensionContext) {
	const loginsProvider = new LoginsProvider();
	vscode.window.registerTreeDataProvider('gemstone-logins', loginsProvider);
	const sessionsProvider = new SessionsProvider(sessions);
	vscode.window.registerTreeDataProvider('gemstone-sessions', sessionsProvider);

	const loginCommand = vscode.commands.registerCommand('gemstone.login', (login: Login) => {
		const gciSession = new GciSession(login);
		const session = new Session(login, gciSession);
		sessions.push(session);
		sessionsProvider.refresh();
	});
	context.subscriptions.push(loginCommand);

	const sessionCommand = vscode.commands.registerCommand('gemstone.logout', (session: Session) => {
		session.logout();
		const index = sessions.indexOf(session);
		sessions.splice(index, 1);
		sessionsProvider.refresh();
	});
	context.subscriptions.push(sessionCommand);
}

// this method is called when your extension is deactivated
export function deactivate() {}
