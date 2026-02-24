import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(),
  getDictionaryEntries: vi.fn(),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
  };
});

import * as fs from 'fs';

import { window, ViewColumn } from '../__mocks__/vscode';
import { SystemBrowser, extractSelector } from '../systemBrowser';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import type { ExportManager } from '../exportManager';

// ── Helpers ──────────────────────────────────────────────────

function makeSession(id = 1, label = 'test'): ActiveSession {
  return {
    id,
    sessionId: id,
    login: { label, gem_host: 'localhost', stone: 'gs64stone', gs_user: 'DataCurator' },
    gciSession: {} as unknown,
    gciVersion: '3.7.1',
    stoneVersion: '3.7.1',
  } as unknown as ActiveSession;
}

function makeExportManager(sessionRoot: string | undefined = '/tmp/gemstone/localhost/gs64stone/DataCurator'): ExportManager {
  return {
    getSessionRoot: vi.fn(() => sessionRoot),
  } as unknown as ExportManager;
}

// ── Selector extraction ──────────────────────────────────────

describe('extractSelector', () => {
  it('extracts unary selector', () => {
    expect(extractSelector('name')).toBe('name');
  });

  it('extracts unary selector ignoring whitespace', () => {
    expect(extractSelector('  size  ')).toBe('size');
  });

  it('extracts binary selector', () => {
    expect(extractSelector('+ anObject')).toBe('+');
  });

  it('extracts multi-char binary selector', () => {
    expect(extractSelector('>= other')).toBe('>=');
  });

  it('extracts single keyword selector', () => {
    expect(extractSelector('at: index')).toBe('at:');
  });

  it('extracts multi-keyword selector', () => {
    expect(extractSelector('at: index put: value')).toBe('at:put:');
  });

  it('extracts keyword selector with underscored params', () => {
    expect(extractSelector('inject: initialValue into: binaryBlock')).toBe('inject:into:');
  });

  it('returns empty string for empty input', () => {
    expect(extractSelector('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(extractSelector('   ')).toBe('');
  });

  it('extracts comma as binary', () => {
    expect(extractSelector(', aCollection')).toBe(',');
  });

  it('extracts tilde as binary', () => {
    expect(extractSelector('~ anObject')).toBe('~');
  });
});

// ── SystemBrowser panel lifecycle ───────────────────────────

describe('SystemBrowser', () => {
  let session: ActiveSession;
  let exportManager: ExportManager;
  let mockPanel: {
    webview: { html: string; postMessage: ReturnType<typeof vi.fn>; onDidReceiveMessage: ReturnType<typeof vi.fn> };
    title: string;
    reveal: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onDidDispose: ReturnType<typeof vi.fn>;
  };
  let messageHandler: (msg: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();

    session = makeSession();
    exportManager = makeExportManager();

    // Capture the panel and the message handler
    vi.mocked(window.createWebviewPanel).mockImplementation((_type: string, title: string) => {
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
        onDidDispose: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
      };
      return mockPanel as unknown as ReturnType<typeof window.createWebviewPanel>;
    });

    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals']);
    vi.mocked(queries.getDictionaryEntries).mockReturnValue([
      { isClass: true, category: 'Kernel', name: 'Array' },
      { isClass: true, category: 'Kernel', name: 'Set' },
      { isClass: true, category: 'Collections', name: 'Bag' },
      { isClass: false, category: '', name: 'AllUsers' },
    ]);
    vi.mocked(queries.getClassEnvironments).mockReturnValue([
      { isMeta: false, envId: 0, category: 'Accessing', selectors: ['name', 'name:'] },
      { isMeta: false, envId: 0, category: 'Comparing', selectors: ['=', 'hash'] },
      { isMeta: true, envId: 0, category: 'Instance Creation', selectors: ['new', 'new:'] },
    ]);
  });

  afterEach(() => {
    (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
  });

  describe('show', () => {
    it('creates a new panel', () => {
      SystemBrowser.show(session, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneSystemBrowser',
        'Browser: test',
        ViewColumn.One,
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('reveals existing panel for same session', () => {
      SystemBrowser.show(session, exportManager);
      SystemBrowser.show(session, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(mockPanel.reveal).toHaveBeenCalledTimes(1);
    });

    it('creates separate panels for different sessions', () => {
      const session2 = makeSession(2, 'other');
      SystemBrowser.show(session, exportManager);
      SystemBrowser.show(session2, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });
  });

  describe('disposeForSession', () => {
    it('disposes the panel for the given session', () => {
      SystemBrowser.show(session, exportManager);
      SystemBrowser.disposeForSession(session.id);
      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('does nothing for unknown session', () => {
      SystemBrowser.disposeForSession(999);
      // Should not throw
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
    });

    it('loads dictionaries on ready', () => {
      messageHandler({ command: 'ready' });
      expect(queries.getDictionaryNames).toHaveBeenCalledWith(session);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals'],
      });
    });

    it('loads class categories on selectDictionary', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      expect(queries.getDictionaryEntries).toHaveBeenCalledWith(session, 1);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: ['** ALL CLASSES **', 'Collections', 'Kernel'],
      });
    });

    it('loads all classes on selectCategory with ALL', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Bag', 'Set'],
      });
    });

    it('loads filtered classes on selectCategory', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: 'Kernel' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Set'],
      });
    });

    it('loads method categories on selectClass', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 1, 'Array', 0);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
      });
    });

    it('loads class-side method categories on toggleSide', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Instance Creation'],
      });
    });

    it('loads all methods on selectMethodCategory with ALL', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: '** ALL METHODS **' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['=', 'hash', 'name', 'name:'],
      });
    });

    it('loads filtered methods on selectMethodCategory', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['name', 'name:'],
      });
    });

    it('posts showError when a handler throws', () => {
      vi.mocked(queries.getDictionaryNames).mockImplementation(() => {
        throw new Error('GCI failure');
      });
      messageHandler({ command: 'ready' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'showError',
        message: 'GCI failure',
      });
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
    });

    it('caches dictionary entries', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectDictionary', index: 1 });
      expect(queries.getDictionaryEntries).toHaveBeenCalledTimes(1);
    });

    it('caches environment data', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(queries.getClassEnvironments).toHaveBeenCalledTimes(1);
    });

    it('clears caches on refresh', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'refresh' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      expect(queries.getDictionaryEntries).toHaveBeenCalledTimes(2);
    });
  });

  describe('file opening', () => {
    const gsContent = [
      'run',
      "Object subclass: 'Array'",
      '  instVarNames: #()',
      '%',
      'method: Array',
      'name',
      '',
      "  ^ 'Array'",
      '%',
      'method: Array',
      'size',
      '',
      '  ^ 0',
      '%',
    ].join('\n');

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
    });

    it('opens .gs file when selecting a class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(gsContent);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/tmp/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/Array.gs' }),
        expect.objectContaining({
          viewColumn: ViewColumn.Beside,
          preserveFocus: true,
        }),
      );
    });

    it('does not open file if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(window.showTextDocument).not.toHaveBeenCalled();
    });

    it('opens file at method line when selecting a method', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(gsContent);

      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(window.showTextDocument).mockClear();

      messageHandler({ command: 'selectMethod', selector: 'size' });

      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/tmp/gemstone/localhost/gs64stone/DataCurator/1. UserGlobals/Array.gs' }),
        expect.objectContaining({
          selection: expect.any(Object),
        }),
      );
    });

    it('does not open file when method not found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('run\n"empty"\n%\n');
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(window.showTextDocument).mockClear();

      // Try to open a method that doesn't exist in the file
      messageHandler({ command: 'selectMethod', selector: 'nonExistentMethod' });
      expect(window.showTextDocument).not.toHaveBeenCalled();
    });
  });

  describe('hierarchy view', () => {
    const hierarchyData: queries.ClassHierarchyEntry[] = [
      { className: 'Object', dictName: 'Globals', kind: 'superclass' },
      { className: 'Collection', dictName: 'Globals', kind: 'superclass' },
      { className: 'SequenceableCollection', dictName: 'Globals', kind: 'superclass' },
      { className: 'Array', dictName: 'UserGlobals', kind: 'self' },
      { className: 'SmallArray', dictName: 'UserGlobals', kind: 'subclass' },
    ];

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(queries.getClassHierarchy).mockReturnValue(hierarchyData);
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('fetches hierarchy and posts data when toggling to hierarchy mode', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).toHaveBeenCalledWith(session, 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'hierarchy',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadHierarchy',
        items: [
          { className: 'Object', dictName: 'Globals', kind: 'superclass', indent: 0 },
          { className: 'Collection', dictName: 'Globals', kind: 'superclass', indent: 1 },
          { className: 'SequenceableCollection', dictName: 'Globals', kind: 'superclass', indent: 2 },
          { className: 'Array', dictName: 'UserGlobals', kind: 'self', indent: 3 },
          { className: 'SmallArray', dictName: 'UserGlobals', kind: 'subclass', indent: 4 },
        ],
        selectedClass: 'Array',
      });
    });

    it('posts empty hierarchy when no class is selected', () => {
      // Deselect class by selecting a new dictionary
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'hierarchy',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadHierarchy',
        items: [],
        selectedClass: null,
      });
    });

    it('restores category data when toggling back to category mode', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'category' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'category',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: ['** ALL CLASSES **', 'Collections', 'Kernel'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Bag', 'Set'],
      });
    });

    it('loads method categories when selecting a hierarchy class', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'selectHierarchyClass', className: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
      });
    });

    it('resolves correct dictionary for hierarchy class from different dict', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      // Select 'Collection' which is in 'Globals' (index 2)
      messageHandler({ command: 'selectHierarchyClass', className: 'Collection' });

      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 2, 'Collection', 0);
    });

    it('ignores selectHierarchyClass for unknown class', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(queries.getClassEnvironments).mockClear();
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'selectHierarchyClass', className: 'NoSuchClass' });

      expect(queries.getClassEnvironments).not.toHaveBeenCalled();
    });

    it('caches hierarchy data per class', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      messageHandler({ command: 'toggleViewMode', mode: 'category' });
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).toHaveBeenCalledTimes(1);
    });

    it('clears hierarchy cache on refresh', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      messageHandler({ command: 'refresh' });

      // Re-navigate to a class and toggle to hierarchy
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).toHaveBeenCalledTimes(2);
    });

    it('refresh resets view mode to category', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'refresh' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'category',
      });
    });
  });
});
