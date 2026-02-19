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
}));

import { Uri, FileSystemError } from '../__mocks__/vscode';
import { GemStoneFileSystemProvider } from '../gemstoneFileSystemProvider';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';

function makeSessionManager() {
  return {
    getSessions: vi.fn(() => [
      { id: 1, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' },
    ]),
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

  describe('session lookup', () => {
    it('throws Unavailable when session is gone', () => {
      const mgr = { getSessions: vi.fn(() => []) } as unknown as SessionManager;
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
