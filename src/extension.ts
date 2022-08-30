/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

import * as vscode from 'vscode';

import { MyFileSystemProvider } from './MyFileSystemProvider';

let context: vscode.ExtensionContext;

export function activate(aContext: vscode.ExtensionContext) {
	console.log('activate');
	context = aContext;
	const subscription = vscode.workspace.registerFileSystemProvider(
		'scheme',
		new MyFileSystemProvider(),
		{ isCaseSensitive: true, isReadonly: false }
	);
	context.subscriptions.push(subscription);
}

export async function deactivate() { }
