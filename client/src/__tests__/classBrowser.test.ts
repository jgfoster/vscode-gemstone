import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  getClassNames: vi.fn(),
  getDictionaryEntries: vi.fn(),
  getClassDefinition: vi.fn(),
  getSuperclassDictName: vi.fn(),
  getClassComment: vi.fn(),
  canClassBeWritten: vi.fn(),
  compileClassDefinition: vi.fn(),
  setClassComment: vi.fn(),
  getPoolDictionaryNames: vi.fn(),
}));

import { window, ViewColumn } from '../__mocks__/vscode';
import { ClassBrowser, parseClassDefinition, buildClassDefinition } from '../classBrowser';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import type { GemStoneLogin } from '../loginTypes';

function makeSession(id = 1): ActiveSession {
  return { id, login: { label: 'test' } as GemStoneLogin } as unknown as ActiveSession;
}

// ── parseClassDefinition ──────────────────────────────────

describe('parseClassDefinition', () => {
  it('parses superclass name and class name', () => {
    const def = parseClassDefinition("Object subclass: 'MyClass'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.superclassName).toBe('Object');
    expect(def.className).toBe('MyClass');
  });

  it('parses non-empty instVarNames', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #('x' 'y')\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.instVarNames).toEqual(['x', 'y']);
  });

  it('parses empty instVarNames as empty array', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.instVarNames).toEqual([]);
  });

  it('parses classVars and classInstVars', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #('ClassVar')\n  classInstVars: #('CiVar')\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.classVarNames).toEqual(['ClassVar']);
    expect(def.classInstVarNames).toEqual(['CiVar']);
  });

  it('parses inDictionary', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: DataCurator\n  options: #()");
    expect(def.inDictName).toBe('DataCurator');
  });

  it('parses optional category', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  category: 'Kernel-Objects'\n  options: #()");
    expect(def.category).toBe('Kernel-Objects');
  });

  it('returns empty string for missing category', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.category).toBe('');
  });

  it('parses options', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #(#modifiable #subclassesDisallowed)");
    expect(def.options).toEqual(['modifiable', 'subclassesDisallowed']);
  });

  it('parses empty options as empty array', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.options).toEqual([]);
  });
});

// ── buildClassDefinition ─────────────────────────────────

describe('buildClassDefinition', () => {
  it('builds a minimal class definition', () => {
    const src = buildClassDefinition({
      superclassName: 'Object',
      superclassDictName: 'UserGlobals',
      className: 'MyClass',
      instVarNames: [],
      classVarNames: [],
      classInstVarNames: [],
      poolDictionaries: [],
      inDictName: 'UserGlobals',
      category: '',
      options: [],
    });
    expect(src).toContain("Object subclass: 'MyClass'");
    expect(src).toContain('instVarNames: #()');
    expect(src).toContain('inDictionary: UserGlobals');
    expect(src).toContain('options: #()');
    expect(src).not.toContain('category:');
  });

  it('includes non-empty instVarNames', () => {
    const src = buildClassDefinition({
      superclassName: 'Object', superclassDictName: '', className: 'Foo',
      instVarNames: ['x', 'y'], classVarNames: [], classInstVarNames: [],
      poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: [],
    });
    expect(src).toContain("instVarNames: #('x' 'y')");
  });

  it('includes category when present', () => {
    const src = buildClassDefinition({
      superclassName: 'Object', superclassDictName: '', className: 'Foo',
      instVarNames: [], classVarNames: [], classInstVarNames: [],
      poolDictionaries: [], inDictName: 'UserGlobals', category: 'My-Cat', options: [],
    });
    expect(src).toContain("category: 'My-Cat'");
  });

  it('includes options as symbols', () => {
    const src = buildClassDefinition({
      superclassName: 'Object', superclassDictName: '', className: 'Foo',
      instVarNames: [], classVarNames: [], classInstVarNames: [],
      poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: ['modifiable'],
    });
    expect(src).toContain('options: #(#modifiable)');
  });

  it('round-trips through parse then build', () => {
    const original = "Object subclass: 'MyClass'\n  instVarNames: #('x' 'y')\n  classVars: #('CV')\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #(#modifiable)";
    const parsed = parseClassDefinition(original);
    const rebuilt = buildClassDefinition({ ...parsed, superclassDictName: 'UserGlobals' });
    // Parse again to compare fields
    const reparsed = parseClassDefinition(rebuilt);
    expect(reparsed.className).toBe('MyClass');
    expect(reparsed.instVarNames).toEqual(['x', 'y']);
    expect(reparsed.classVarNames).toEqual(['CV']);
    expect(reparsed.options).toEqual(['modifiable']);
  });
});

// ── ClassBrowser panel lifecycle ─────────────────────────

describe('ClassBrowser', () => {
  let session: ActiveSession;
  let mockPanel: ReturnType<typeof window.createWebviewPanel>;
  let messageHandler: (msg: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    (ClassBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();

    session = makeSession();

    vi.mocked(window.createWebviewPanel).mockImplementation((_type, title) => {
      mockPanel = {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
            messageHandler = handler;
            return { dispose: () => {} };
          }),
        },
        title,
        reveal: vi.fn(),
        dispose: vi.fn(),
        onDidDispose: vi.fn(() => ({ dispose: () => {} })),
      } as unknown as ReturnType<typeof window.createWebviewPanel>;
      return mockPanel;
    });

    vi.mocked(queries.getClassDefinition).mockReturnValue(
      "Object subclass: 'Array'\n  instVarNames: #('x')\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()"
    );
    vi.mocked(queries.getSuperclassDictName).mockReturnValue('Kernel');
    vi.mocked(queries.getClassComment).mockReturnValue('An ordered collection.');
    vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
    vi.mocked(queries.getDictionaryEntries).mockReturnValue([
      { isClass: true, category: 'Kernel', name: 'Array' },
    ]);
    vi.mocked(queries.getClassNames).mockReturnValue(['Object', 'Array', 'String']);
    vi.mocked(queries.getPoolDictionaryNames).mockReturnValue(['Globals', 'UserGlobals', 'MyPool']);
  });

  afterEach(() => {
    (ClassBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
  });

  describe('showOrUpdate (first call)', () => {
    it('creates a webview panel in ViewColumn.Two', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals', 'Globals'], 1, null);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneClassBrowser', 'Class Definition', ViewColumn.Two,
        expect.objectContaining({ enableScripts: true }),
      );
    });

    it('sends loadDictionaries after ready', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals', 'Globals'], 1, null);
      messageHandler({ command: 'ready' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals'],
      });
    });

    it('sends loadPoolDictionaries with all visible SymbolDictionary names', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals', 'Globals'], 1, null);
      messageHandler({ command: 'ready' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadPoolDictionaries',
        items: ['Globals', 'UserGlobals', 'MyPool'],
      });
    });

    it('sends loadDefinition with null for new class form', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals', 'Globals'], 1, null);
      messageHandler({ command: 'ready' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadDefinition', definition: null, canEdit: true }),
      );
    });

    it('fetches class info and sends loadDefinition when className is provided', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals', 'Globals'], 1, 'Array');
      messageHandler({ command: 'ready' });
      const calls = vi.mocked(mockPanel.webview.postMessage).mock.calls;
      const defMsg = calls.find(c => (c[0] as { command: string }).command === 'loadDefinition')?.[0] as { definition: { className: string; description: string } };
      expect(defMsg.definition.className).toBe('Array');
      expect(defMsg.definition.description).toBe('An ordered collection.');
    });

    it('sets panel title to Class Definition: <name> for existing class', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, 'Array');
      messageHandler({ command: 'ready' });
      expect(mockPanel.title).toBe('Class Definition: Array');
    });
  });

  describe('showOrUpdate (subsequent calls)', () => {
    beforeEach(async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, null);
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
      vi.mocked(window.createWebviewPanel).mockClear();
    });

    it('reuses the existing panel', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, 'Array');
      expect(window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('reveals the existing panel without stealing focus', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, 'Array');
      expect(mockPanel.reveal).toHaveBeenCalledWith(undefined, true);
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals', 'Globals'], 1, 'Array');
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('responds to requestSuperclassNames with class list', () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Object', 'Number']);
      messageHandler({ command: 'requestSuperclassNames', dictName: 'UserGlobals' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadSuperclassNames',
        dictName: 'UserGlobals',
        items: ['Object', 'Number'],
        defaultClassName: undefined,
      });
    });

    it('passes defaultClassName through in loadSuperclassNames response', () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Object', 'Number']);
      messageHandler({ command: 'requestSuperclassNames', dictName: 'Globals', defaultClassName: 'Object' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadSuperclassNames',
        dictName: 'Globals',
        items: ['Object', 'Number'],
        defaultClassName: 'Object',
      });
    });

    it('responds to requestCategories with sorted unique categories', () => {
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([
        { isClass: true, category: 'Kernel', name: 'Array' },
        { isClass: true, category: 'Collections', name: 'Set' },
        { isClass: true, category: 'Kernel', name: 'String' },
      ]);
      messageHandler({ command: 'requestCategories', dictName: 'UserGlobals' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadCategories',
        items: ['Collections', 'Kernel'],
      });
    });

    it('compiles class definition on save', () => {
      messageHandler({
        command: 'save',
        definition: {
          superclassName: 'Object', superclassDictName: 'UserGlobals',
          className: 'MyClass', instVarNames: ['x'], classVarNames: [],
          classInstVarNames: [], poolDictionaries: [],
          inDictName: 'UserGlobals', category: '', options: [],
        },
        description: '',
      });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(
        session,
        expect.stringContaining("Object subclass: 'MyClass'"),
      );
    });

    it('sets class comment on save when description is non-empty', () => {
      messageHandler({
        command: 'save',
        definition: {
          superclassName: 'Object', superclassDictName: 'UserGlobals',
          className: 'MyClass', instVarNames: [], classVarNames: [],
          classInstVarNames: [], poolDictionaries: [],
          inDictName: 'UserGlobals', category: '', options: [],
        },
        description: 'My class comment.',
      });
      expect(queries.setClassComment).toHaveBeenCalledWith(session, 'MyClass', 'My class comment.');
    });

    it('does not call setClassComment when description is blank', () => {
      messageHandler({
        command: 'save',
        definition: {
          superclassName: 'Object', superclassDictName: '', className: 'Foo',
          instVarNames: [], classVarNames: [], classInstVarNames: [],
          poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: [],
        },
        description: '   ',
      });
      expect(queries.setClassComment).not.toHaveBeenCalled();
    });

    it('posts saveSuccess after successful save', () => {
      messageHandler({
        command: 'save',
        definition: {
          superclassName: 'Object', superclassDictName: '', className: 'Foo',
          instVarNames: [], classVarNames: [], classInstVarNames: [],
          poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: [],
        },
        description: '',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({ command: 'saveSuccess' });
    });

    it('posts showError when save throws', () => {
      vi.mocked(queries.compileClassDefinition).mockImplementation(() => {
        throw new Error('Compile failed');
      });
      messageHandler({
        command: 'save',
        definition: {
          superclassName: 'Object', superclassDictName: '', className: 'Foo',
          instVarNames: [], classVarNames: [], classInstVarNames: [],
          poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: [],
        },
        description: '',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'showError',
        message: 'Compile failed',
      });
    });
  });

  describe('disposeForSession', () => {
    it('disposes the panel', async () => {
      await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, null);
      ClassBrowser.disposeForSession(session.id);
      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('is a no-op when no panel exists', () => {
      expect(() => ClassBrowser.disposeForSession(99)).not.toThrow();
    });
  });
});
