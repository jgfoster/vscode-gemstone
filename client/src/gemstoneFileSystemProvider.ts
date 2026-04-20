import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';
import { logInfo } from './gciLog';

// ── URI Structure ────────────────────────────────────────────
// Workspace:  gemstone://{sessionId}/Workspace
// Method:     gemstone://{sessionId}/{dictName}/{className}/{side}/{category}/{selector}
// Definition: gemstone://{sessionId}/{dictName}/{className}/definition
// Comment:    gemstone://{sessionId}/{dictName}/{className}/comment
// New class:  gemstone://{sessionId}/{dictName}/new-class
// New method: gemstone://{sessionId}/{dictName}/{className}/{side}/{category}/new-method

interface ParsedMethodUri {
  kind: 'method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  selector: string;
  environmentId: number;
}

interface ParsedDefinitionUri {
  kind: 'definition';
  sessionId: number;
  dictName: string;
  className: string;
}

interface ParsedCommentUri {
  kind: 'comment';
  sessionId: number;
  dictName: string;
  className: string;
}

interface ParsedNewClassUri {
  kind: 'new-class';
  sessionId: number;
  dictName: string;
  category?: string;
}

interface ParsedNewMethodUri {
  kind: 'new-method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  environmentId: number;
}

interface ParsedWorkspaceUri {
  kind: 'workspace';
  sessionId: number;
}

type ParsedUri = ParsedMethodUri | ParsedDefinitionUri | ParsedCommentUri | ParsedNewClassUri | ParsedNewMethodUri | ParsedWorkspaceUri;

function parseUri(uri: vscode.Uri): ParsedUri {
  const sessionId = parseInt(uri.authority, 10);
  const parts = uri.path.split('/').map(decodeURIComponent);
  // parts[0] is '' (leading /)

  // Parse optional ?env=N from query string
  const envMatch = uri.query?.match(/env=(\d+)/);
  const environmentId = envMatch ? parseInt(envMatch[1], 10) : 0;

  if (parts.length === 2 && parts[1] === 'Workspace') {
    return { kind: 'workspace', sessionId };
  }
  if (parts.length === 3 && parts[2] === 'new-class') {
    const catMatch = uri.query?.match(/category=([^&]+)/);
    const category = catMatch ? decodeURIComponent(catMatch[1]) : undefined;
    return { kind: 'new-class', sessionId, dictName: parts[1], category };
  }
  if (parts.length === 4 && parts[3] === 'definition') {
    return { kind: 'definition', sessionId, dictName: parts[1], className: parts[2] };
  }
  if (parts.length === 4 && parts[3] === 'comment') {
    return { kind: 'comment', sessionId, dictName: parts[1], className: parts[2] };
  }
  if (parts.length === 6 && parts[5] === 'new-method') {
    return {
      kind: 'new-method',
      sessionId,
      dictName: parts[1],
      className: parts[2],
      isMeta: parts[3] === 'class',
      category: parts[4],
      environmentId,
    };
  }
  if (parts.length === 6) {
    return {
      kind: 'method',
      sessionId,
      dictName: parts[1],
      className: parts[2],
      isMeta: parts[3] === 'class',
      category: parts[4],
      selector: parts[5],
      environmentId,
    };
  }
  throw vscode.FileSystemError.FileNotFound(uri);
}

// ── FileSystemProvider ────────────────────────────────────────

const MOD_KEY = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
export const WORKSPACE_TEMPLATE =
  `"Workspace\nPlace cursor anywhere on a line with code\nand press [<${MOD_KEY}>+<;> followed by <D>]\n(note that this is a two-keypress chord) to display"\n6 * 7\n`;

export class GemStoneFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private diagnostics = vscode.languages.createDiagnosticCollection('gemstone-method');
  private workspaceContents = new Map<number, Uint8Array>();

  constructor(private sessionManager: SessionManager) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    logInfo(`[FS] stat ${uri.toString()}`);
    const stat: vscode.FileStat = {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
    const parsed = parseUri(uri);
    // Workspaces and new documents are always writable — no existing class to check
    if (parsed.kind === 'workspace' || parsed.kind === 'new-class' || parsed.kind === 'new-method') return stat;
    const session = this.sessionManager.getSession(parsed.sessionId);
    if (!session) return stat;
    try {
      if (!queries.canClassBeWritten(session, parsed.className)) {
        stat.permissions = vscode.FilePermission.Readonly;
      }
    } catch {
      // If the query fails (e.g., session busy), allow editing
    }
    logInfo(`[FS] stat → ${stat.permissions === vscode.FilePermission.Readonly ? 'readonly' : 'writable'}`);
    return stat;
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const parsed = parseUri(uri);

    if (parsed.kind === 'workspace') {
      return this.workspaceContents.get(parsed.sessionId)
        ?? new TextEncoder().encode(WORKSPACE_TEMPLATE);
    }

    if (parsed.kind === 'new-class') {
      const categoryLine = parsed.category ? `\n  category: '${parsed.category}'` : '';
      const template =
`Object subclass: 'NameOfClass'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: ${parsed.dictName}${categoryLine}
  options: #()`;
      return new TextEncoder().encode(template);
    }

    if (parsed.kind === 'new-method') {
      const template =
`messageSelector
  "comment"
  | temporaries |
  statements`;
      return new TextEncoder().encode(template);
    }

    const session = this.getSession(parsed.sessionId);

    let text: string;
    switch (parsed.kind) {
      case 'method':
        text = queries.getMethodSource(session, parsed.className, parsed.isMeta, parsed.selector, parsed.environmentId);
        break;
      case 'definition':
        text = queries.getClassDefinition(session, parsed.className);
        break;
      case 'comment':
        text = queries.getClassComment(session, parsed.className);
        break;
    }

    return new TextEncoder().encode(text);
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): void {
    logInfo(`[FS] writeFile ${uri.toString()} (${content.length} bytes)`);
    const parsed = parseUri(uri);

    if (parsed.kind === 'workspace') {
      this.workspaceContents.set(parsed.sessionId, content);
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    const session = this.getSession(parsed.sessionId);
    const source = new TextDecoder().decode(content);

    try {
      switch (parsed.kind) {
        case 'method':
          queries.compileMethod(
            session, parsed.className, parsed.isMeta, parsed.category, source, parsed.environmentId,
          );
          vscode.window.showInformationMessage(
            `Compiled ${parsed.className}${parsed.isMeta ? ' class' : ''}>>#${parsed.selector}`
          );
          break;
        case 'definition':
          queries.compileClassDefinition(session, source);
          vscode.window.showInformationMessage(
            `Class definition updated for ${parsed.className}`
          );
          break;
        case 'comment':
          queries.setClassComment(session, parsed.className, source);
          vscode.window.showInformationMessage(
            `Comment updated for ${parsed.className}`
          );
          break;
        case 'new-class':
          queries.compileClassDefinition(session, source);
          vscode.window.showInformationMessage('Class created');
          break;
        case 'new-method':
          queries.compileMethod(
            session, parsed.className, parsed.isMeta, parsed.category, source, parsed.environmentId,
          );
          vscode.window.showInformationMessage(
            `Compiled new method in ${parsed.className}${parsed.isMeta ? ' class' : ''}`
          );
          break;
      }

      this.diagnostics.delete(uri);
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      logInfo(`[FS] writeFile → success (${parsed.kind})`);
    } catch (e: unknown) {
      if (e instanceof BrowserQueryError) {
        logInfo(`[FS] writeFile → compile error: ${e.message}`);
        // Parse line number from GCI error message (e.g. "... (line 3, ...")
        const lineMatch = e.message.match(/line\s+(\d+)/i);
        const lineNum = lineMatch ? parseInt(lineMatch[1], 10) - 1 : 0;
        const range = new vscode.Range(
          new vscode.Position(Math.max(0, lineNum), 0),
          new vscode.Position(Math.max(0, lineNum), Number.MAX_SAFE_INTEGER),
        );
        const diag = new vscode.Diagnostic(range, e.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GemStone';
        this.diagnostics.set(uri, [diag]);
        // Do not rethrow — VS Code considers the save complete; old method still
        // lives in GemStone. The user sees the red squiggle and can fix and re-save.
        return;
      }
      logInfo(`[FS] writeFile → unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  /**
   * Close all open editor tabs for a given session (scheme: gemstone, authority: sessionId).
   */
  closeTabsForSession(sessionId: number): void {
    const auth = String(sessionId);
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri?.scheme === 'gemstone' && input.uri.authority === auth) {
          vscode.window.tabGroups.close(tab);
        }
      }
    }
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot create directories');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot delete methods from here');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot rename methods');
  }

  private getSession(sessionId: number) {
    const sessions = this.sessionManager.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      throw vscode.FileSystemError.Unavailable(
        `GemStone session ${sessionId} is no longer active`
      );
    }
    return session;
  }
}
