import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { ExportManager } from './exportManager';
import { fileInClass } from './topazFileIn';
import { SystemBrowser } from './systemBrowser';
import * as queries from './browserQueries';

/**
 * Generate a Topaz file-out template for a new class.
 */
export function newClassTemplate(className: string, dictName: string): string {
  return `! Class definition for ${className}
run
Object subclass: '${className}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: ${dictName}
  category: ''
  options: #()
%

doit
${className} comment: 'A brief description of ${className}.'
%

! ------------------- Class methods for ${className}

category: 'instance creation'
classmethod: ${className}
new

\t^ self basicNew
\t\tinitialize;
\t\tyourself
%

! ------------------- Instance methods for ${className}

category: 'initialization'
method: ${className}
initialize

\tsuper initialize.
%
`;
}

/**
 * Manages compiling .gs files back into GemStone on save.
 *
 * Listens for `onDidSaveTextDocument` on `.gs` files under the export root,
 * parses the Topaz file-out format, and compiles each class definition and
 * method back into GemStone. Errors are shown in the Problems panel.
 */
export class FileInManager {
  private diagnostics: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private sessionManager: SessionManager,
    private exportManager: ExportManager,
  ) {
    this.diagnostics = vscode.languages.createDiagnosticCollection('gemstone-filein');
  }

  register(context: vscode.ExtensionContext): void {
    const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (this.shouldHandle(doc)) {
        this.handleSave(doc);
      }
    });
    const createSub = vscode.workspace.onDidCreateFiles((e) => {
      for (const file of e.files) {
        this.handleFileCreate(file);
      }
    });
    const deleteSub = vscode.workspace.onDidDeleteFiles((e) => {
      for (const file of e.files) {
        this.handleFileDelete(file);
      }
    });
    this.disposables.push(saveSub, createSub, deleteSub);
    context.subscriptions.push(saveSub, createSub, deleteSub, this.diagnostics);
  }

  private shouldHandle(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== 'file') return false;
    if (!document.uri.fsPath.endsWith('.gs')) return false;
    if (this.exportManager.isWriting) return false;

    const exportRoot = this.exportManager.getExportRoot();
    if (!exportRoot) return false;

    // Only handle files under the export root
    const relative = path.relative(exportRoot, document.uri.fsPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private handleFileCreate(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    if (this.exportManager.isWriting) return;

    const exportRoot = this.exportManager.getExportRoot();
    if (!exportRoot) return;

    const relative = path.relative(exportRoot, uri.fsPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return;

    // Append .gs if the file has no extension
    let filePath = uri.fsPath;
    if (!path.extname(filePath)) {
      const newPath = filePath + '.gs';
      fs.renameSync(filePath, newPath);
      filePath = newPath;
    }

    if (!filePath.endsWith('.gs')) return;

    // Check the file is empty (newly created)
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) return;
    } catch {
      return;
    }

    // Extract class name from filename and dictionary name from parent dir
    const className = path.basename(filePath, '.gs');
    const dictDir = path.basename(path.dirname(filePath));
    const dictNameMatch = dictDir.match(/^\d+\.\s+(.*)/);
    if (!dictNameMatch) return;
    const dictName = dictNameMatch[1];

    const template = newClassTemplate(className, dictName);
    fs.writeFileSync(filePath, template, 'utf-8');

    // File in the template so the class exists in GemStone
    const session = this.resolveSessionFromPath(filePath);
    if (session) {
      fileInClass(session, template);
      SystemBrowser.refresh(session.id);
    }

    if (filePath !== uri.fsPath) {
      // Close the stale tab for the original file
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input as { uri?: vscode.Uri } | undefined;
          if (input?.uri?.fsPath === uri.fsPath) {
            vscode.window.tabGroups.close(tab);
          }
        }
      }
      // Open the renamed file
      vscode.window.showTextDocument(vscode.Uri.file(filePath));
    }
  }

  private handleFileDelete(uri: vscode.Uri): void {
    if (uri.scheme !== 'file') return;
    if (this.exportManager.isWriting) return;

    const exportRoot = this.exportManager.getExportRoot();
    if (!exportRoot) return;

    const relative = path.relative(exportRoot, uri.fsPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return;

    const session = this.resolveSessionFromPath(uri.fsPath);
    if (!session) return;

    // Path: {exportRoot}/{gem_host}/{stone}/{gs_user}/{N. DictName}/{ClassName}.gs
    const parts = relative.split(path.sep);

    if (uri.fsPath.endsWith('.gs') && parts.length >= 5) {
      // Deleting a .gs file → remove class from GemStone
      const dictDir = parts[3];
      const dictMatch = dictDir.match(/^(\d+)\.\s+(.*)/);
      if (!dictMatch) return;
      const dictIndex = parseInt(dictMatch[1], 10);
      const className = path.basename(uri.fsPath, '.gs');
      try {
        queries.deleteClass(session, dictIndex, className);
        SystemBrowser.refresh(session.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to remove class "${className}" from GemStone: ${msg}`);
      }
    } else if (parts.length === 4) {
      // Deleting a {N. DictName} directory → remove dictionary from symbol list
      const dictDir = parts[3];
      const dictMatch = dictDir.match(/^(\d+)\.\s+(.*)/);
      if (!dictMatch) return;
      const dictIndex = parseInt(dictMatch[1], 10);
      try {
        queries.removeDictionary(session, dictIndex);
        SystemBrowser.refresh(session.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to remove dictionary from GemStone: ${msg}`);
      }
    }
  }

  private handleSave(document: vscode.TextDocument): void {
    const session = this.resolveSessionFromPath(document.uri.fsPath);
    if (!session) {
      vscode.window.showWarningMessage(
        'No active GemStone session for this file.',
      );
      return;
    }

    const result = fileInClass(session, document.getText());

    if (result.success) {
      this.diagnostics.delete(document.uri);
      const parts: string[] = [];
      if (result.compiledClassDef) parts.push('class definition');
      if (result.compiledMethods > 0) parts.push(`${result.compiledMethods} method(s)`);
      vscode.window.showInformationMessage(
        `Filed in ${parts.join(' + ')} for ${path.basename(document.uri.fsPath, '.gs')}.`,
      );
    } else {
      const diags = result.errors.map((err) => {
        const range = new vscode.Range(
          new vscode.Position(err.line, 0),
          new vscode.Position(err.line, Number.MAX_SAFE_INTEGER),
        );
        const diag = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GemStone';
        return diag;
      });
      this.diagnostics.set(document.uri, diags);

      const errorCount = result.errors.length;
      const compiled = result.compiledMethods + (result.compiledClassDef ? 1 : 0);
      const msg = compiled > 0
        ? `File-in: ${errorCount} error(s), ${compiled} item(s) compiled. See Problems panel.`
        : `File-in failed with ${errorCount} error(s). See Problems panel.`;
      vscode.window.showErrorMessage(msg);
    }
  }

  /**
   * Map a .gs file path back to the active session whose login fields
   * match the {gem_host}/{stone}/{gs_user} path segments.
   */
  resolveSessionFromPath(fsPath: string): ActiveSession | undefined {
    const exportRoot = this.exportManager.getExportRoot();
    if (!exportRoot) return undefined;

    // Path: {exportRoot}/{gem_host}/{stone}/{gs_user}/{N. DictName}/{ClassName}.gs
    const relative = path.relative(exportRoot, fsPath);
    const parts = relative.split(path.sep);
    if (parts.length < 3) return undefined;

    const [gemHost, stone, gsUser] = parts;
    return this.sessionManager.getSessions().find(
      (s) =>
        s.login.gem_host === gemHost &&
        s.login.stone === stone &&
        s.login.gs_user === gsUser,
    );
  }

  /**
   * Check if any open .gs files under a session's export root have unsaved changes.
   */
  hasUnsavedChanges(session: ActiveSession): boolean {
    const sessionRoot = this.exportManager.getSessionRoot(session);
    if (!sessionRoot) return false;

    return vscode.workspace.textDocuments.some(
      (doc) =>
        doc.isDirty &&
        doc.uri.scheme === 'file' &&
        doc.uri.fsPath.endsWith('.gs') &&
        doc.uri.fsPath.startsWith(sessionRoot),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.diagnostics.dispose();
  }
}
