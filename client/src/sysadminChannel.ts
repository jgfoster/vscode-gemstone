import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getSysadminChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GemStone Admin');
  }
  return channel;
}

export function appendSysadmin(text: string): void {
  if (!text) return;
  getSysadminChannel().appendLine(text);
}

export function showSysadmin(): void {
  getSysadminChannel().show(true);
}
