/*
 *  gemstone: GemStone/S 64 Bit IDE for Visual Studio Code
 */

import * as vscode from 'vscode';
import { MyFileSystemProvider } from './MyFileSystemProvider';

let context: vscode.ExtensionContext;

export function activate(aContext: vscode.ExtensionContext) {
	console.log('activate() - 1');
	if (!isValidSetup()) { return; }
	context = aContext;
	const subscription = vscode.workspace.registerFileSystemProvider(
		'scheme',
		new MyFileSystemProvider(),
		{ isCaseSensitive: true, isReadonly: false }
	);
	context.subscriptions.push(subscription);

	const workspaceFolders = vscode.workspace.workspaceFolders;
	vscode.workspace.updateWorkspaceFolders(
		workspaceFolders ? workspaceFolders.length : 0,
		null,
		...[{ 'uri': vscode.Uri.parse('scheme:/root'), 'name': 'root' }]);
	console.log('activate() - 2');
}

export async function deactivate() {
}

// on activation check to see if we have a workspace and a folder
// "If the first workspace folder is added, removed or changed, the currently executing extensions 
// (including the one that called this method) will be terminated and restarted" 
// [updateWorkspaceFolders()](https://code.visualstudio.com/api/references/vscode-api#workspace.updateWorkspaceFolders), 
// and we can't have that!
function isValidSetup(): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.log("This extension requires a workspace!");
		return false;
	}
	if (workspaceFolders.length === 0) {
		console.log("This extension requires at least one folder in the workspace!");
		return false;
	}
	return true;
}
