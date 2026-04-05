import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

// Mock browserQueries
vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
  getMethodSource: vi.fn(() => 'at: index\n  ^self basicAt: index'),
  getClassDefinition: vi.fn(() => "Object subclass: 'Array'\n  instVarNames: #()"),
  getClassComment: vi.fn(() => 'An ordered collection.'),
  compileMethod: vi.fn(() => 1n),
  compileClassDefinition: vi.fn(),
  setClassComment: vi.fn(),
  canClassBeWritten: vi.fn(() => true),
}));

import { Uri, FileSystemError, FilePermission, window, languages } from '../__mocks__/vscode';
import { GemStoneFileSystemProvider, WORKSPACE_TEMPLATE } from '../gemstoneFileSystemProvider';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { BrowserQueryError } from '../browserQueries';

function makeSession(id = 1, gs_user = 'DataCurator') {
  return { id, gci: {}, handle: {}, login: { label: 'Test', gs_user }, stoneVersion: '3.7.2' };
}

function makeSessionManager(gs_user = 'DataCurator') {
  const session = makeSession(1, gs_user);
  return {
    getSessions: vi.fn(() => [session]),
    getSession: vi.fn((id: number) => id === 1 ? session : undefined),
  } as unknown as SessionManager;
}

describe('GemStoneFileSystemProvider', () => {
  let provider: GemStoneFileSystemProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GemStoneFileSystemProvider(makeSessionManager());
  });

  describe('stat', () => {
    it('returns a file stat', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.type).toBe(1); // FileType.File
      expect(stat.ctime).toBe(0);
      expect(stat.mtime).toBeGreaterThan(0);
    });

    it('calls canClassBeWritten for method URIs', () => {
      provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(queries.canClassBeWritten).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'Array');
    });

    it('returns writable when canClassBeWritten returns true', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });

    it('returns read-only when canClassBeWritten returns false', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('returns read-only for class definitions when canClassBeWritten returns false', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/definition'));
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('returns read-only for class comments when canClassBeWritten returns false', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValue(false);
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/comment'));
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('allows editing when canClassBeWritten throws (e.g., session busy)', () => {
      vi.mocked(queries.canClassBeWritten).mockImplementation(() => { throw new BrowserQueryError('Session busy'); });
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });

    it('always returns writable for new-class URIs without calling canClassBeWritten', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/UserGlobals/new-class'));
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('always returns writable for new-method URIs without calling canClassBeWritten', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method'));
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('returns writable when session is not found', () => {
      const mgr = { getSessions: vi.fn(() => []), getSession: vi.fn(() => undefined) } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      const stat = p.stat(Uri.parse('gemstone://99/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });
  });

  describe('readFile', () => {
    it('reads a method source', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toBe('at: index\n  ^self basicAt: index');
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }), 'Array', false, 'at:', 0,
      );
    });

    it('reads a class-side method source', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', true, 'new:', 0,
      );
    });

    it('reads a method source with environment from query param', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=2');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, '__len__', 2,
      );
    });

    it('reads a class definition', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("Object subclass: 'Array'");
      expect(queries.getClassDefinition).toHaveBeenCalledWith(
        expect.anything(), 'Array',
      );
    });

    it('reads a class comment', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toBe('An ordered collection.');
      expect(queries.getClassComment).toHaveBeenCalledWith(
        expect.anything(), 'Array',
      );
    });

    it('returns new-class template with dictionary name', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("Object subclass: 'NameOfClass'");
      expect(content).toContain('inDictionary: UserGlobals');
    });

    it('returns new-method template', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain('messageSelector');
      expect(content).toContain('"comment"');
    });

    it('throws FileNotFound for invalid URI', () => {
      const uri = Uri.parse('gemstone://1/too/few');
      expect(() => provider.readFile(uri)).toThrow();
    });
  });

  describe('writeFile', () => {
    const encode = (s: string) => new TextEncoder().encode(s);

    it('compiles a method on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'accessing', 'at: index\n  ^self basicAt: index', 0,
      );
    });

    it('compiles a method with environment on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=1');
      provider.writeFile(uri, encode('__len__\n  ^self size'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'python', '__len__\n  ^self size', 1,
      );
    });

    it('compiles a class definition on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const source = "Object subclass: 'Array'\n  instVarNames: #()";
      provider.writeFile(uri, encode(source), { create: false, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    it('sets class comment on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment');
      provider.writeFile(uri, encode('Updated comment'), { create: false, overwrite: true });
      expect(queries.setClassComment).toHaveBeenCalledWith(
        expect.anything(), 'Array', 'Updated comment',
      );
    });

    it('compiles new-class on save', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    it('compiles new-method on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const source = 'foo\n  ^42';
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'accessing', source, 0,
      );
    });

    it('shows success message after compiling a method', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Compiled Array>>#at:'),
      );
    });

    it('shows success message for class-side method compilation', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.writeFile(uri, encode('new: size\n  ^self basicNew: size'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', true, 'creation', 'new: size\n  ^self basicNew: size', 0,
      );
    });

    it('fires onDidChangeFile event on success', () => {
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), { create: false, overwrite: true });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 1, uri }),
        ]),
      );
    });
  });

  describe('writeFile diagnostics', () => {
    const encode = (s: string) => new TextEncoder().encode(s);

    function getDiagCollection() {
      // The provider creates the collection during field initialization (constructor),
      // which runs after vi.clearAllMocks() in the outer beforeEach.
      return vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
    }

    it('does not throw on BrowserQueryError — shows diagnostic instead', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error near line 3, column 5', 100);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      expect(() => {
        provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });
      }).not.toThrow();
    });

    it('sets a diagnostic on compile failure', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error near line 3, column 5', 100);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([
          expect.objectContaining({ message: 'Syntax error near line 3, column 5' }),
        ]),
      );
    });

    it('parses line number from error message for the diagnostic range', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Error at line 5: unexpected token', 0);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      const [[, diags]] = (collection.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(diags[0].range.start.line).toBe(4); // line 5 → 0-indexed = 4
    });

    it('uses line 0 when no line number in the error message', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Generic compile error', 0);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      const [[, diags]] = (collection.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(diags[0].range.start.line).toBe(0);
    });

    it('clears diagnostics on successful compile', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      expect(collection.delete).toHaveBeenCalledWith(uri);
      expect(collection.set).not.toHaveBeenCalled();
    });

    it('rethrows non-BrowserQueryError exceptions', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new Error('Unexpected internal error');
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      expect(() => {
        provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });
      }).toThrow('Unexpected internal error');
    });
  });

  describe('closeTabsForSession', () => {
    beforeEach(() => {
      (window.tabGroups.all as unknown[]).length = 0;
    });

    it('closes tabs belonging to the given session', () => {
      const tab1 = { input: { uri: Uri.parse('gemstone://1/Globals/Array/instance/accessing/size') } };
      const tab2 = { input: { uri: Uri.parse('gemstone://1/UserGlobals/MyClass/instance/init/initialize') } };
      (window.tabGroups.all as unknown[]).push({ tabs: [tab1, tab2] });

      provider.closeTabsForSession(1);

      expect(window.tabGroups.close).toHaveBeenCalledWith(tab1);
      expect(window.tabGroups.close).toHaveBeenCalledWith(tab2);
      expect(window.tabGroups.close).toHaveBeenCalledTimes(2);
    });

    it('does not close tabs belonging to a different session', () => {
      const tab1 = { input: { uri: Uri.parse('gemstone://1/Globals/Array/instance/accessing/size') } };
      const tab2 = { input: { uri: Uri.parse('gemstone://2/Globals/Array/instance/accessing/size') } };
      (window.tabGroups.all as unknown[]).push({ tabs: [tab1, tab2] });

      provider.closeTabsForSession(1);

      expect(window.tabGroups.close).toHaveBeenCalledWith(tab1);
      expect(window.tabGroups.close).not.toHaveBeenCalledWith(tab2);
      expect(window.tabGroups.close).toHaveBeenCalledTimes(1);
    });

    it('does not close non-gemstone tabs', () => {
      const tab1 = { input: { uri: Uri.parse('file:///path/to/file.gs') } };
      (window.tabGroups.all as unknown[]).push({ tabs: [tab1] });

      provider.closeTabsForSession(1);

      expect(window.tabGroups.close).not.toHaveBeenCalled();
    });

    it('handles tabs without a URI input gracefully', () => {
      const tab1 = { input: undefined };
      const tab2 = { input: {} };
      (window.tabGroups.all as unknown[]).push({ tabs: [tab1, tab2] });

      expect(() => provider.closeTabsForSession(1)).not.toThrow();
      expect(window.tabGroups.close).not.toHaveBeenCalled();
    });

    it('searches across multiple tab groups', () => {
      const tab1 = { input: { uri: Uri.parse('gemstone://1/Globals/Array/instance/accessing/size') } };
      const tab2 = { input: { uri: Uri.parse('gemstone://1/UserGlobals/MyClass/instance/init/initialize') } };
      (window.tabGroups.all as unknown[]).push({ tabs: [tab1] }, { tabs: [tab2] });

      provider.closeTabsForSession(1);

      expect(window.tabGroups.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('workspace', () => {
    const workspaceUri = Uri.parse('gemstone://1/Workspace');
    const encode = (s: string) => new TextEncoder().encode(s);

    it('stat returns writable without checking canClassBeWritten', () => {
      const stat = provider.stat(workspaceUri);
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('readFile returns workspace template on first read', () => {
      const content = new TextDecoder().decode(provider.readFile(workspaceUri));
      expect(content).toBe(WORKSPACE_TEMPLATE);
    });

    it('readFile returns saved content after writeFile', () => {
      const edited = '"Workspace"\n3 + 4';
      provider.writeFile(workspaceUri, encode(edited), { create: false, overwrite: true });
      const content = new TextDecoder().decode(provider.readFile(workspaceUri));
      expect(content).toBe(edited);
    });

    it('writeFile does not call any GemStone queries', () => {
      provider.writeFile(workspaceUri, encode('anything'), { create: false, overwrite: true });
      expect(queries.compileMethod).not.toHaveBeenCalled();
      expect(queries.compileClassDefinition).not.toHaveBeenCalled();
      expect(queries.setClassComment).not.toHaveBeenCalled();
    });

    it('workspace content is per-session', () => {
      const session2 = makeSession(2);
      const mgr = {
        getSessions: vi.fn(() => [makeSession(1), session2]),
        getSession: vi.fn((id: number) => id === 2 ? session2 : makeSession(1)),
      } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);

      const uri1 = Uri.parse('gemstone://1/Workspace');
      const uri2 = Uri.parse('gemstone://2/Workspace');
      p.writeFile(uri1, encode('session 1 content'), { create: false, overwrite: true });

      expect(new TextDecoder().decode(p.readFile(uri1))).toBe('session 1 content');
      expect(new TextDecoder().decode(p.readFile(uri2))).toBe(WORKSPACE_TEMPLATE);
    });
  });

  describe('session lookup', () => {
    it('throws Unavailable when session is gone', () => {
      const mgr = {
        getSessions: vi.fn(() => []),
        getSession: vi.fn(() => undefined),
      } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      const uri = Uri.parse('gemstone://99/Globals/Array/definition');
      expect(() => p.readFile(uri)).toThrow();
    });
  });

  describe('URI parsing', () => {
    it('parses method URI with special characters', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3Aput%3A');
      const content = provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'at:put:', 0,
      );
    });

    it('parses class side correctly', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', true, 'new:', 0,
      );
    });

    it('distinguishes new-method from regular method', () => {
      // new-method URI
      const uri1 = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const content1 = new TextDecoder().decode(provider.readFile(uri1));
      expect(content1).toContain('messageSelector');

      // regular method called "size"
      const uri2 = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      provider.readFile(uri2);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'size', 0,
      );
    });
  });
});
