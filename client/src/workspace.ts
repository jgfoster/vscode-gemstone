import * as vscode from 'vscode';
import { logInfo } from './gciLog';

export async function openWorkspace(sessionId: number): Promise<void> {
  const uri = vscode.Uri.parse(`gemstone://${sessionId}/Workspace`);
  const uriString = uri.toString();
  logInfo(`[Workspace] opening ${uriString}`);
  const alreadyOpen = vscode.workspace.textDocuments.some(
    doc => doc.uri.toString() === uriString,
  );
  if (alreadyOpen) {
    logInfo('[Workspace] already open, skipping');
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    logInfo('[Workspace] opened successfully');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`[Workspace] ERROR: ${msg}`);
  }
}
