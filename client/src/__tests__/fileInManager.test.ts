import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../topazFileIn', () => ({
  fileInClass: vi.fn(() => ({
    success: true,
    errors: [],
    compiledMethods: 2,
    compiledClassDef: true,
  })),
}));

import * as vscode from 'vscode';
import { FileInManager, newClassTemplate } from '../fileInManager';
import { SessionManager, ActiveSession } from '../sessionManager';
import { ExportManager } from '../exportManager';
import { GemStoneLogin } from '../loginTypes';
import { fileInClass } from '../topazFileIn';

function createMockSession(overrides?: Partial<GemStoneLogin>): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
      ...overrides,
    },
    stoneVersion: '3.7.2',
  };
}

function createMockSessionManager(sessions: ActiveSession[] = []): SessionManager {
  return {
    getSessions: vi.fn(() => sessions),
  } as unknown as SessionManager;
}

function createMockExportManager(overrides: {
  exportRoot?: string;
  sessionRoot?: string;
  isWriting?: boolean;
} = {}): ExportManager {
  return {
    getExportRoot: vi.fn(() => overrides.exportRoot ?? '/workspace/gemstone'),
    getSessionRoot: vi.fn(() => overrides.sessionRoot ?? '/workspace/gemstone/localhost/gs64stone/DataCurator'),
    isWriting: overrides.isWriting ?? false,
  } as unknown as ExportManager;
}

function createMockDocument(fsPath: string, options: { scheme?: string; isDirty?: boolean; text?: string } = {}): vscode.TextDocument {
  return {
    uri: {
      scheme: options.scheme ?? 'file',
      fsPath,
      toString: () => `file://${fsPath}`,
    },
    isDirty: options.isDirty ?? false,
    getText: vi.fn(() => options.text ?? 'method: MyClass\nfoo\n  ^ 42\n%\n'),
  } as unknown as vscode.TextDocument;
}

describe('FileInManager', () => {
  let manager: FileInManager;
  let mockSessionManager: SessionManager;
  let mockExportManager: ExportManager;
  let mockSession: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    (fileInClass as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      errors: [],
      compiledMethods: 2,
      compiledClassDef: true,
    });
    mockSession = createMockSession();
    mockSessionManager = createMockSessionManager([mockSession]);
    mockExportManager = createMockExportManager();
    manager = new FileInManager(mockSessionManager, mockExportManager);
  });

  describe('resolveSessionFromPath', () => {
    it('matches session by gem_host/stone/gs_user path segments', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBe(mockSession);
    });

    it('returns undefined for paths outside export root', () => {
      const fsPath = '/other/path/MyClass.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBeUndefined();
    });

    it('returns undefined when no session matches', () => {
      const fsPath = '/workspace/gemstone/otherhost/otherstone/otheruser/1. Dict/MyClass.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBeUndefined();
    });

    it('returns undefined when export root is undefined', () => {
      mockExportManager = createMockExportManager({ exportRoot: undefined as unknown as string });
      (mockExportManager.getExportRoot as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      manager = new FileInManager(mockSessionManager, mockExportManager);

      const result = manager.resolveSessionFromPath('/some/path/MyClass.gs');
      expect(result).toBeUndefined();
    });

    it('matches the correct session among multiple', () => {
      const session2 = createMockSession({ gem_host: 'remote', stone: 'prod', gs_user: 'Admin' });
      session2.id = 2;
      mockSessionManager = createMockSessionManager([mockSession, session2]);
      manager = new FileInManager(mockSessionManager, mockExportManager);

      const fsPath = '/workspace/gemstone/remote/prod/Admin/1. Globals/Object.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBe(session2);
    });
  });

  describe('hasUnsavedChanges', () => {
    it('returns true when dirty .gs files exist under session root', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
        { isDirty: true },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(true);
    });

    it('returns false when no dirty files exist', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
        { isDirty: false },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });

    it('returns false for dirty files outside session root', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/otherhost/otherstone/otheruser/1. Dict/Other.gs',
        { isDirty: true },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });

    it('returns false for dirty non-.gs files', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/notes.txt',
        { isDirty: true },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });

    it('returns false when session root is undefined', () => {
      (mockExportManager.getSessionRoot as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });
  });

  describe('register + handleSave', () => {
    let savedHandler: (doc: vscode.TextDocument) => void;

    beforeEach(() => {
      (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mockImplementation(
        (handler: (doc: vscode.TextDocument) => void) => {
          savedHandler = handler;
          return { dispose: () => {} };
        },
      );
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      manager.register(context);
    });

    it('compiles on save and shows success message', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
      );
      savedHandler(doc);

      expect(fileInClass).toHaveBeenCalledWith(mockSession, doc.getText());
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Filed in'),
      );
    });

    it('shows error message and sets diagnostics on failure', () => {
      (fileInClass as ReturnType<typeof vi.fn>).mockReturnValue({
        success: false,
        errors: [{ message: 'Syntax error', line: 3, className: 'MyClass', selector: 'foo' }],
        compiledMethods: 0,
        compiledClassDef: false,
      });

      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
      );
      savedHandler(doc);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('error'),
      );
      // Diagnostics should be set
      const diagCollection = vscode.languages.createDiagnosticCollection as ReturnType<typeof vi.fn>;
      const collection = diagCollection.mock.results[0].value;
      expect(collection.set).toHaveBeenCalled();
    });

    it('clears diagnostics on successful save', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
      );
      savedHandler(doc);

      const diagCollection = vscode.languages.createDiagnosticCollection as ReturnType<typeof vi.fn>;
      const collection = diagCollection.mock.results[0].value;
      expect(collection.delete).toHaveBeenCalledWith(doc.uri);
    });

    it('skips non-.gs files', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/notes.txt',
      );
      savedHandler(doc);

      expect(fileInClass).not.toHaveBeenCalled();
    });

    it('skips files outside export root', () => {
      const doc = createMockDocument('/other/path/MyClass.gs');
      savedHandler(doc);

      expect(fileInClass).not.toHaveBeenCalled();
    });

    it('skips when isWriting is true', () => {
      (mockExportManager as unknown as { isWriting: boolean }).isWriting = true;
      // Need to get the actual property descriptor working
      Object.defineProperty(mockExportManager, 'isWriting', { get: () => true });

      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
      );
      savedHandler(doc);

      expect(fileInClass).not.toHaveBeenCalled();
    });

    it('skips non-file scheme documents', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
        { scheme: 'gemstone' },
      );
      savedHandler(doc);

      expect(fileInClass).not.toHaveBeenCalled();
    });

    it('shows warning when no matching session found', () => {
      mockSessionManager = createMockSessionManager([]);
      manager = new FileInManager(mockSessionManager, mockExportManager);
      // Re-register to get new handler
      (vscode.workspace.onDidSaveTextDocument as ReturnType<typeof vi.fn>).mockImplementation(
        (handler: (doc: vscode.TextDocument) => void) => {
          savedHandler = handler;
          return { dispose: () => {} };
        },
      );
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      manager.register(context);

      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/MyClass.gs',
      );
      savedHandler(doc);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No active GemStone session'),
      );
    });
  });

  describe('newClassTemplate', () => {
    it('includes class definition with Object superclass', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("Object subclass: 'MyClass'");
    });

    it('uses the given dictionary name in inDictionary:', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain('inDictionary: UserGlobals');
    });

    it('includes a comment template', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("MyClass comment: 'A brief description of MyClass.'");
    });

    it('includes class-side new method with instance creation category', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("category: 'instance creation'");
      expect(template).toContain('classmethod: MyClass');
      expect(template).toContain('new');
      expect(template).toContain('self basicNew');
      expect(template).toContain('initialize');
      expect(template).toContain('yourself');
    });

    it('includes instance-side initialize method with initialization category', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("category: 'initialization'");
      expect(template).toContain('method: MyClass');
      expect(template).toContain('super initialize.');
    });

    it('uses class name and dictionary name in all appropriate places', () => {
      const template = newClassTemplate('Account', 'Published');
      expect(template).toContain("Object subclass: 'Account'");
      expect(template).toContain('inDictionary: Published');
      expect(template).toContain('classmethod: Account');
      expect(template).toContain('method: Account');
      expect(template).toContain("Account comment: 'A brief description of Account.'");
    });

    it('includes standard class definition fields', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain('instVarNames: #()');
      expect(template).toContain('classVars: #()');
      expect(template).toContain('classInstVars: #()');
      expect(template).toContain('poolDictionaries: #()');
      expect(template).toContain('options: #()');
    });
  });

  describe('handleFileCreate', () => {
    let tmpDir: string;
    let exportRoot: string;
    let createHandler: (e: { files: vscode.Uri[] }) => void;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filein-test-'));
      exportRoot = tmpDir;
      mockExportManager = createMockExportManager({ exportRoot });
      manager = new FileInManager(mockSessionManager, mockExportManager);

      (vscode.workspace.onDidCreateFiles as ReturnType<typeof vi.fn>).mockImplementation(
        (handler: (e: { files: vscode.Uri[] }) => void) => {
          createHandler = handler;
          return { dispose: () => {} };
        },
      );
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      manager.register(context);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function createUri(fsPath: string): vscode.Uri {
      return { scheme: 'file', fsPath } as unknown as vscode.Uri;
    }

    it('populates an empty .gs file with template', () => {
      const dictDir = path.join(exportRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain("Object subclass: 'MyClass'");
      expect(content).toContain('inDictionary: UserGlobals');
    });

    it('extracts dictionary name from numbered directory', () => {
      const dictDir = path.join(exportRoot, '3. Published');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'Account.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('inDictionary: Published');
      expect(content).toContain("Object subclass: 'Account'");
    });

    it('skips non-empty files', () => {
      const dictDir = path.join(exportRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, 'existing content', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('existing content');
    });

    it('skips non-.gs files', () => {
      const dictDir = path.join(exportRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'notes.txt');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('skips files outside export root', () => {
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'other-'));
      const dictDir = path.join(otherDir, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
      fs.rmSync(otherDir, { recursive: true, force: true });
    });

    it('skips directories without numeric prefix', () => {
      const dictDir = path.join(exportRoot, 'notes');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('skips when isWriting is true', () => {
      Object.defineProperty(mockExportManager, 'isWriting', { get: () => true, configurable: true });

      const dictDir = path.join(exportRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('skips non-file scheme URIs', () => {
      const dictDir = path.join(exportRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      const uri = { scheme: 'gemstone', fsPath: filePath } as unknown as vscode.Uri;
      createHandler({ files: [uri] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });
  });
});
