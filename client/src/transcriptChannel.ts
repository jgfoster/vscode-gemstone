import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getTranscriptChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GemStone Transcript');
  }
  return channel;
}

export function appendTranscript(text: string): void {
  if (!text) return;
  getTranscriptChannel().appendLine(text);
}

export function showTranscript(): void {
  getTranscriptChannel().show(true);
}
