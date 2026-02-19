import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';

// ── URI Structure ────────────────────────────────────────────
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

type ParsedUri = ParsedMethodUri | ParsedDefinitionUri | ParsedCommentUri | ParsedNewClassUri | ParsedNewMethodUri;

function parseUri(uri: vscode.Uri): ParsedUri {
  const sessionId = parseInt(uri.authority, 10);
  const parts = uri.path.split('/').map(decodeURIComponent);
  // parts[0] is '' (leading /)

  // Parse optional ?env=N from query string
  const envMatch = uri.query?.match(/env=(\d+)/);
  const environmentId = envMatch ? parseInt(envMatch[1], 10) : 0;

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

export class GemStoneFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private sessionManager: SessionManager) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(_uri: vscode.Uri): vscode.FileStat {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const parsed = parseUri(uri);

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
    const parsed = parseUri(uri);
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

      this._onDidChangeFile.fire([{
        type: vscode.FileChangeType.Changed,
        uri,
      }]);
    } catch (e: unknown) {
      if (e instanceof BrowserQueryError) {
        vscode.window.showErrorMessage(`Error: ${e.message}`);
        throw vscode.FileSystemError.NoPermissions(uri);
      }
      throw e;
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
