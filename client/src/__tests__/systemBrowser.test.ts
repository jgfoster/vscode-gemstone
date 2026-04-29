import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(),
  getDictionaryEntries: vi.fn(),
  getGlobalsForDictionary: vi.fn(),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(),
  addDictionary: vi.fn(),
  moveDictionaryUp: vi.fn(),
  moveDictionaryDown: vi.fn(),
  deleteClass: vi.fn(),
  moveClass: vi.fn(),
  deleteMethod: vi.fn(),
  recategorizeMethod: vi.fn(),
  removeDictionary: vi.fn(),
  renameCategory: vi.fn(),
  getMethodCategories: vi.fn(),
  referencesToObject: vi.fn(),
}));

vi.mock('../globalsBrowser', () => ({
  GlobalsBrowser: {
    showOrUpdate: vi.fn().mockResolvedValue(undefined),
    disposeForSession: vi.fn(),
  },
}));

vi.mock('../classBrowser', () => ({
  ClassBrowser: {
    showOrUpdate: vi.fn().mockResolvedValue(undefined),
    disposeForSession: vi.fn(),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import * as fs from 'fs';

import * as path from 'path';
import { window, workspace, ViewColumn, TextEditorRevealType, Range, Selection, Position, commands, __setConfig, __resetConfig } from '../__mocks__/vscode';
import { SystemBrowser, extractSelector } from '../systemBrowser';
import * as queries from '../browserQueries';
import { GlobalsBrowser } from '../globalsBrowser';
import { ClassBrowser } from '../classBrowser';
import type { ActiveSession } from '../sessionManager';
import type { ExportManager } from '../exportManager';

// ── Helpers ──────────────────────────────────────────────────

const SESSION_ROOT = path.join('/tmp', 'gemstone', 'localhost', 'gs64stone', 'DataCurator');

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

function makeExportManager(sessionRoot: string | undefined = SESSION_ROOT): ExportManager {
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
    onDidChangeViewState: ReturnType<typeof vi.fn>;
  };
  let messageHandler: (msg: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
    (SystemBrowser as unknown as { lastActive: Map<number, unknown> }).lastActive = new Map();

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
        onDidChangeViewState: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
      };
      return mockPanel as unknown as ReturnType<typeof window.createWebviewPanel>;
    });

    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals']);
    vi.mocked(queries.getGlobalsForDictionary).mockReturnValue([]);
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
    (SystemBrowser as unknown as { lastActive: Map<number, unknown> }).lastActive = new Map();
  });

  describe('show', () => {
    it('creates a new panel with initial title Browser', () => {
      SystemBrowser.show(session, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneSystemBrowser',
        'Browser',
        ViewColumn.One,
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('creates a new panel each time for the same session', () => {
      SystemBrowser.show(session, exportManager);
      SystemBrowser.show(session, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });

    it('creates separate panels for different sessions', () => {
      const session2 = makeSession(2, 'other');
      SystemBrowser.show(session, exportManager);
      SystemBrowser.show(session2, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });

    it('updates title to Browser: ClassName when a class is selected', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(mockPanel.title).toBe('Browser: Array');
    });
  });

  describe('disposeForSession', () => {
    it('disposes all panels for the given session', () => {
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

    it('does not open a file when selecting a class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(gsContent);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(window.showTextDocument).not.toHaveBeenCalled();
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('opens a gemstone:// method editor when selecting a method', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'selectMethodCategory', name: 'accessing' });
      messageHandler({ command: 'selectMethod', selector: 'size' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.scheme).toBe('gemstone');
      expect(uri.path).toContain('/Array/instance/');
      expect(uri.path).toContain('/size');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preview: true }),
      );
    });

    it('includes the method category in the gemstone:// URI', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'selectMethodCategory', name: 'accessing' });
      messageHandler({ command: 'selectMethod', selector: 'size' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('accessing');
    });

    it('uses class side in URI when isMeta is true', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });

      messageHandler({ command: 'selectMethodCategory', name: 'instance creation' });
      messageHandler({ command: 'selectMethod', selector: 'new' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('/class/');
    });

    it('uses "as yet unclassified" when ALL METHODS is selected', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: '** ALL METHODS **' });
      messageHandler({ command: 'selectMethod', selector: 'name' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('as%20yet%20unclassified');
      expect(uri.path).not.toContain('ALL%20METHODS');
    });

    it('uses "as yet unclassified" when no method category is selected', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethod', selector: 'name' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('as%20yet%20unclassified');
    });

    it('opens a gemstone:// editor even when method is not found in the .gs file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'selectMethod', selector: 'nonExistentMethod' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.scheme).toBe('gemstone');
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
        selected: '** ALL CLASSES **',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Bag', 'Set'],
        selected: 'Array',
      });
    });

    it('restores class selection and method categories when toggling back to category mode', () => {
      // Select a class so method categories are loaded
      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'category' });

      // Class list should include the selected class
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadClasses',
          selected: 'Array',
        }),
      );
      // Method categories should be restored
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
      });
    });

    it('restores method category and method selection when toggling back to category mode', () => {
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      messageHandler({ command: 'selectMethod', selector: 'size' });

      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'category' });

      // Method categories should be restored with selection
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
        selected: 'Accessing',
      });
      // Methods should be restored with selection
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadMethods',
          selected: 'size',
        }),
      );
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

    // Regression: a hierarchy-view click previously updated the column
    // list inline without routing through applyClassSelection, so the
    // Class Definition panel didn't refresh — the user reported it as
    // "Class Definition subtab is not updated like it is if I simply
    // click on another class." Pin that the click now refreshes the
    // Class Definition.
    it('refreshes the Class Definition panel when a hierarchy class is clicked', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();

      messageHandler({ command: 'selectHierarchyClass', className: 'Collection' });

      expect(ClassBrowser.showOrUpdate).toHaveBeenCalledWith(
        session, expect.any(Array), expect.any(Number), 'Collection',
      );
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

  describe('dictionary context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
    });

    it('adds a dictionary after input', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('NewDict');
      // After addDictionary, getDictionaryNames will be called again — return updated list
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals', 'NewDict']);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      await messageHandler({ command: 'ctxAddDictionary' });

      expect(queries.addDictionary).toHaveBeenCalledWith(session, 'NewDict');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals', 'NewDict'],
      });
    });

    it('creates a directory on disk for the new dictionary', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('NewDict');
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals', 'NewDict']);

      await messageHandler({ command: 'ctxAddDictionary' });

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(SESSION_ROOT, '3-NewDict'),
        { recursive: true },
      );
    });

    it('does nothing when user cancels add dictionary', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue(undefined);
      await messageHandler({ command: 'ctxAddDictionary' });
      expect(queries.addDictionary).not.toHaveBeenCalled();
    });

    it('moves dictionary up', () => {
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxMoveDictUp' });

      expect(queries.moveDictionaryUp).toHaveBeenCalledWith(session, 2);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['Globals', 'UserGlobals'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'selectDictionaryItem',
        index: 1,
      });
    });

    it('does not move first dictionary up', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'ctxMoveDictUp' });
      expect(queries.moveDictionaryUp).not.toHaveBeenCalled();
    });

    it('moves dictionary down', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxMoveDictDown' });

      expect(queries.moveDictionaryDown).toHaveBeenCalledWith(session, 1);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['Globals', 'UserGlobals'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'selectDictionaryItem',
        index: 2,
      });
    });

    it('does not move last dictionary down', () => {
      messageHandler({ command: 'selectDictionary', index: 2 });
      messageHandler({ command: 'ctxMoveDictDown' });
      expect(queries.moveDictionaryDown).not.toHaveBeenCalled();
    });

    it('removes dictionary after confirmation', async () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(window.showWarningMessage).mockResolvedValue('Remove' as never);
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['Globals']);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      await messageHandler({ command: 'ctxRemoveDictionary' });

      expect(queries.removeDictionary).toHaveBeenCalledWith(session, 1);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['Globals'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: [],
      });
    });

    it('does not remove dictionary when user cancels', async () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined as never);

      await messageHandler({ command: 'ctxRemoveDictionary' });

      expect(queries.removeDictionary).not.toHaveBeenCalled();
    });

    it('deletes directory on disk when removing dictionary', async () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(window.showWarningMessage).mockResolvedValue('Remove' as never);
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['Globals']);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await messageHandler({ command: 'ctxRemoveDictionary' });

      expect(fs.rmSync).toHaveBeenCalledWith(
        path.join(SESSION_ROOT, '1-UserGlobals'),
        { recursive: true, force: true },
      );
    });
  });

  describe('class context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('deletes class after confirmation', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Delete' as never);

      await messageHandler({ command: 'ctxDeleteClass' });

      expect(queries.deleteClass).toHaveBeenCalledWith(session, 1, 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses' }),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [],
      });
    });

    it('does not delete class when user cancels', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined as never);
      await messageHandler({ command: 'ctxDeleteClass' });
      expect(queries.deleteClass).not.toHaveBeenCalled();
    });

    it('moves class to another dictionary', async () => {
      vi.mocked(window.showQuickPick).mockResolvedValue({ label: 'Globals', index: 2 } as never);

      await messageHandler({ command: 'ctxMoveClass' });

      expect(queries.moveClass).toHaveBeenCalledWith(session, 1, 2, 'Array');
    });

    it('delegates run tests to command', () => {
      messageHandler({ command: 'ctxRunTests' });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.runSunitClass',
        { className: 'Array' },
      );
    });

  });

  describe('method category context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('renames method category', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('Getters');

      await messageHandler({ command: 'ctxRenameCategory' });

      expect(queries.renameCategory).toHaveBeenCalledWith(
        session, 'Array', false, 'Accessing', 'Getters',
      );
    });

    it('does not rename when user cancels', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue(undefined);
      await messageHandler({ command: 'ctxRenameCategory' });
      expect(queries.renameCategory).not.toHaveBeenCalled();
    });
  });

  describe('method context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      messageHandler({ command: 'selectMethod', selector: 'name' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('deletes method after confirmation', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Delete' as never);

      await messageHandler({ command: 'ctxDeleteMethod' });

      expect(queries.deleteMethod).toHaveBeenCalledWith(session, 'Array', false, 'name');
    });

    it('refreshes method list after deletion', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Delete' as never);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      await messageHandler({ command: 'ctxDeleteMethod' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories' }),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethods' }),
      );
    });

    it('does not delete method when user cancels', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined as never);
      await messageHandler({ command: 'ctxDeleteMethod' });
      expect(queries.deleteMethod).not.toHaveBeenCalled();
    });

    it('moves method to category', async () => {
      vi.mocked(queries.getMethodCategories).mockReturnValue(['Accessing', 'Comparing', 'Printing']);
      vi.mocked(window.showQuickPick).mockResolvedValue('Printing' as never);

      await messageHandler({ command: 'ctxMoveToCategory' });

      expect(queries.recategorizeMethod).toHaveBeenCalledWith(
        session, 'Array', false, 'name', 'Printing',
      );
    });

    it('delegates senders to command', () => {
      messageHandler({ command: 'ctxSendersOf' });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.sendersOfSelector',
        { selector: 'name', sessionId: 1 },
      );
    });

    it('delegates implementors to command', () => {
      messageHandler({ command: 'ctxImplementorsOf' });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.implementorsOfSelector',
        { selector: 'name', sessionId: 1 },
      );
    });

    it('delegates browse references to command', () => {
      messageHandler({ command: 'ctxBrowseReferences', name: 'Array' });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.browseReferences',
        { objectName: 'Array', sessionId: 1 },
      );
    });

    it('opens new method template in the bottom editor group', async () => {
      vi.mocked(workspace.openTextDocument).mockClear();
      vi.mocked(window.showTextDocument).mockClear();
      messageHandler({ command: 'ctxNewMethod' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { scheme: string; path: string };
      expect(uri.scheme).toBe('gemstone');
      expect(uri.path).toContain('/new-method');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: ViewColumn.Two, preview: true }),
      );
    });

    it('uses "as yet unclassified" for new method when ALL METHODS is selected', async () => {
      messageHandler({ command: 'selectMethodCategory', name: '** ALL METHODS **' });
      vi.mocked(workspace.openTextDocument).mockClear();
      messageHandler({ command: 'ctxNewMethod' });
      await vi.waitFor(() => { expect(workspace.openTextDocument).toHaveBeenCalled(); });

      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { path: string };
      expect(uri.path).toContain('as%20yet%20unclassified');
      expect(uri.path).not.toContain('ALL%20METHODS');
    });
  });

  describe('drag-and-drop', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('recategorizes method when dropped on a category', () => {
      messageHandler({ command: 'dropMethodOnCategory', selector: 'name', category: 'Comparing' });

      expect(queries.recategorizeMethod).toHaveBeenCalledWith(
        session, 'Array', false, 'name', 'Comparing',
      );
    });

    it('reloads method categories after drop', () => {
      messageHandler({ command: 'dropMethodOnCategory', selector: 'name', category: 'Comparing' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories' }),
      );
    });

    it('does nothing when no class is selected for method drop', () => {
      // Deselect class by selecting a new dictionary
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'dropMethodOnCategory', selector: 'name', category: 'Comparing' });

      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('moves class when dropped on a different dictionary', () => {
      messageHandler({ command: 'dropClassOnDictionary', className: 'Array', dictName: 'Globals' });

      expect(queries.moveClass).toHaveBeenCalledWith(session, 1, 2, 'Array');
    });

    it('shows info message after moving class', () => {
      messageHandler({ command: 'dropClassOnDictionary', className: 'Array', dictName: 'Globals' });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Moved Array to Globals.');
    });

    it('does not move class to the same dictionary', () => {
      messageHandler({ command: 'dropClassOnDictionary', className: 'Array', dictName: 'UserGlobals' });

      expect(queries.moveClass).not.toHaveBeenCalled();
    });

    it('does not move class when no dictionary is selected', () => {
      // Create a fresh browser with no dictionary selected
      (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels.clear();
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });

      messageHandler({ command: 'dropClassOnDictionary', className: 'Array', dictName: 'Globals' });

      expect(queries.moveClass).not.toHaveBeenCalled();
    });
  });

  describe('GlobalsBrowser and ClassBrowser integration', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
    });

    it('opens GlobalsBrowser when a dictionary is selected', () => {
      expect(vi.mocked(GlobalsBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session, 'UserGlobals', 1,
      );
    });

    it('opens ClassBrowser with null className when a dictionary is selected', () => {
      expect(vi.mocked(ClassBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session, ['UserGlobals', 'Globals'], 1, null,
      );
    });

    it('does not include ** GLOBALS ** in class categories', () => {
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: ['** ALL CLASSES **', 'Collections', 'Kernel'],
      });
    });

    it('opens ClassBrowser with className when a class is selected', () => {
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(vi.mocked(ClassBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session, ['UserGlobals', 'Globals'], 1, 'Array',
      );
    });
  });

  describe('multi-environment', () => {
    beforeEach(() => {
      __setConfig('gemstone', 'maxEnvironment', 2);
      vi.mocked(queries.getClassEnvironments).mockReturnValue([
        { isMeta: false, envId: 0, category: 'Accessing', selectors: ['name', 'name:'] },
        { isMeta: false, envId: 0, category: 'Comparing', selectors: ['=', 'hash'] },
        { isMeta: false, envId: 1, category: 'Ruby', selectors: ['rb_name'] },
        { isMeta: true, envId: 0, category: 'Instance Creation', selectors: ['new', 'new:'] },
      ]);
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
    });

    afterEach(() => {
      __resetConfig();
    });

    it('sends setMaxEnvironment on ready when maxEnvironment > 0', () => {
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setMaxEnvironment',
        maxEnv: 2,
      });
    });

    it('does not send setMaxEnvironment when maxEnvironment is 0', () => {
      __setConfig('gemstone', 'maxEnvironment', 0);
      (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
      SystemBrowser.show(makeSession(2, 'other'), exportManager);
      const otherHandler = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!
        .value.webview.onDidReceiveMessage.mock.calls[0][0];
      otherHandler({ command: 'ready' });

      const calls = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!
        .value.webview.postMessage.mock.calls;
      expect(calls.some((c: unknown[]) => (c[0] as { command: string }).command === 'setMaxEnvironment')).toBe(false);
    });

    it('passes maxEnvironment to getClassEnvironments', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 1, 'Array', 2);
    });

    it('shows env 0 method categories by default', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
      });
    });

    it('switches to env 1 method categories on toggleEnvironment', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Ruby'],
      });
    });

    it('shows empty categories for environment with no methods', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 2 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **'],
      });
    });

    it('resets env to 0 on refresh', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      messageHandler({ command: 'refresh' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
      });
    });
  });

  describe('static refresh', () => {
    it('refreshes the browser for a given session', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals'],
      });
    });

    it('restores dictionary and category selection after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'selectDictionaryItem',
        index: 1,
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: expect.any(Array),
        selected: '** ALL CLASSES **',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: expect.any(Array),
      });
    });

    it('does nothing when no browser exists for the session', () => {
      // No browser has been created — should not throw
      SystemBrowser.refresh(999);
    });

    it('restores class selection after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: expect.any(Array),
        selected: 'Array',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories' }),
      );
    });

    it('restores class-side toggle after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setSide',
        isMeta: true,
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Instance Creation'],
      });
    });

    it('restores method category selection after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
        selected: 'Accessing',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['name', 'name:'],
      });
    });

    it('does not restore class when it no longer exists after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      // After refresh, the class no longer exists
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([
        { isClass: true, category: 'Kernel', name: 'Set' },
      ]);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      // Should not try to select a class that no longer exists
      const calls = vi.mocked(mockPanel.webview.postMessage).mock.calls.map(c => c[0]);
      const loadClassesCalls = calls.filter((c: Record<string, unknown>) => c.command === 'loadClasses');
      for (const call of loadClassesCalls) {
        expect((call as Record<string, unknown>).selected).toBeUndefined();
      }
      // Should not load method categories (no class selected)
      const postRefreshCalls = calls.filter((c: Record<string, unknown>) => c.command === 'loadMethodCategories');
      expect(postRefreshCalls).toHaveLength(0);
    });
  });

  describe('methodCompiled', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
    });

    it('refreshes method categories after a method is compiled', () => {
      vi.mocked(queries.getClassEnvironments).mockClear();
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.methodCompiled(session.id, 'Array');

      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 1, 'Array', 0);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: ['** ALL METHODS **', 'Accessing', 'Comparing'],
        selected: 'Accessing',
      });
    });

    it('refreshes the method list for the selected category', () => {
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.methodCompiled(session.id, 'Array');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['name', 'name:'],
      });
    });

    it('does nothing when the compiled class is not selected', () => {
      vi.mocked(queries.getClassEnvironments).mockClear();
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.methodCompiled(session.id, 'String');

      expect(queries.getClassEnvironments).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('does nothing when no browser exists for the session', () => {
      SystemBrowser.methodCompiled(999, 'Array');
    });
  });

  describe('navigateTo', () => {
    const result: queries.MethodSearchResult = {
      dictName: 'UserGlobals',
      className: 'Array',
      isMeta: false,
      category: 'Accessing',
      selector: 'name',
    };

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' }); // populates state.dictionaries
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('returns false when no browser is open for the session', () => {
      expect(SystemBrowser.navigateTo(999, result)).toBe(false);
    });

    it('returns true when a browser is open for the session', () => {
      expect(SystemBrowser.navigateTo(session.id, result)).toBe(true);
    });

    it('reveals the panel with preserveFocus so the editor keeps focus', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.reveal).toHaveBeenCalledWith(undefined, true);
    });

    it('does nothing when the dictName is not in the loaded dictionaries', () => {
      const unknown = { ...result, dictName: 'UnknownDict' };
      SystemBrowser.navigateTo(session.id, unknown);
      expect(mockPanel.reveal).not.toHaveBeenCalled();
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('updates the panel title to the selected class', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.title).toBe('Browser: Array');
    });

    it('posts loadClasses with the selected class', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses', selected: 'Array' }),
      );
    });

    it('posts loadMethodCategories with the selected category', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories', selected: 'Accessing' }),
      );
    });

    it('posts loadMethods with the selected selector', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethods', selected: 'name' }),
      );
    });

    it('opens the method in a gemstone:// preview tab', async () => {
      SystemBrowser.navigateTo(session.id, result);
      await vi.waitFor(() => expect(workspace.openTextDocument).toHaveBeenCalled());
      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { scheme: string; path: string };
      expect(uri.scheme).toBe('gemstone');
      expect(uri.path).toContain('/Array/instance/');
      expect(uri.path).toContain('/name');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preview: true }),
      );
    });

    it('uses class side in the URI when isMeta is true', async () => {
      const classSide = { ...result, isMeta: true, category: 'Instance Creation', selector: 'new' };
      SystemBrowser.navigateTo(session.id, classSide);
      await vi.waitFor(() => expect(workspace.openTextDocument).toHaveBeenCalled());
      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { path: string };
      expect(uri.path).toContain('/class/');
    });

    it('navigates only the most recently active browser', async () => {
      const firstPanel = mockPanel;
      // Open a second browser for the same session
      SystemBrowser.show(session, exportManager);
      const secondPanel = vi.mocked(window.createWebviewPanel).mock.results[1].value as typeof mockPanel;
      messageHandler({ command: 'ready' });

      SystemBrowser.navigateTo(session.id, result);
      // First browser was created first so it is the default active target
      expect(firstPanel.reveal).toHaveBeenCalled();
      expect(secondPanel.reveal).not.toHaveBeenCalled();
    });

    // Regression: navigateTo previously updated the column-list state
    // inline (skipping handleSelectClass), so the Class Definition panel
    // didn't refresh when an Implementors-of / Senders-of jump landed on
    // a different class. Now routed through applyClassSelection so the
    // Class Definition tracks the column-list selection.
    it('refreshes the Class Definition panel when the selected class changes', () => {
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();
      SystemBrowser.navigateTo(session.id, result);
      expect(ClassBrowser.showOrUpdate).toHaveBeenCalledWith(
        session, expect.any(Array), expect.any(Number), 'Array',
      );
    });
  });

  describe('navigateToClass', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('returns false when no browser is open for the session', () => {
      expect(SystemBrowser.navigateToClass(999, 'UserGlobals', 'Array')).toBe(false);
    });

    it('returns true when a browser is open for the session', () => {
      expect(SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array')).toBe(true);
    });

    it('reveals the panel with preserveFocus', () => {
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.reveal).toHaveBeenCalledWith(undefined, true);
    });

    it('does nothing when the dictName is not in the loaded dictionaries', () => {
      SystemBrowser.navigateToClass(session.id, 'UnknownDict', 'Array');
      expect(mockPanel.reveal).not.toHaveBeenCalled();
    });

    it('updates the panel title to the selected class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.title).toBe('Browser: Array');
    });

    it('posts loadClasses with the selected class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses', selected: 'Array' }),
      );
    });

    it('posts loadMethodCategories with no selected method', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethods', selected: null }),
      );
    });

    it('navigates only the most recently active browser', () => {
      const firstPanel = mockPanel;
      SystemBrowser.show(session, exportManager);
      const secondPanel = vi.mocked(window.createWebviewPanel).mock.results[1].value as typeof mockPanel;
      messageHandler({ command: 'ready' });

      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      // First browser was created first so it is the default active target
      expect(firstPanel.reveal).toHaveBeenCalled();
      expect(secondPanel.reveal).not.toHaveBeenCalled();
    });

    it('switches target when onDidChangeViewState fires on another browser', () => {
      const firstPanel = mockPanel;
      SystemBrowser.show(session, exportManager);
      const secondPanel = vi.mocked(window.createWebviewPanel).mock.results[1].value as typeof mockPanel;
      messageHandler({ command: 'ready' });

      // Simulate the second panel becoming active
      const viewStateHandler = secondPanel.onDidChangeViewState.mock.calls[0][0] as (e: { webviewPanel: { active: boolean } }) => void;
      viewStateHandler({ webviewPanel: { active: true } });

      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(secondPanel.reveal).toHaveBeenCalled();
      expect(firstPanel.reveal).not.toHaveBeenCalled();
    });
  });

  describe('getSelectedClassName', () => {
    it('returns null when no browser is open for the session', () => {
      expect(SystemBrowser.getSelectedClassName(999)).toBeNull();
    });

    it('returns null when no class is selected', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      expect(SystemBrowser.getSelectedClassName(session.id)).toBeNull();
    });

    it('returns the selected class and dictionary name', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: '** ALL CLASSES **' });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      const result = SystemBrowser.getSelectedClassName(session.id);
      expect(result).toEqual({ dictName: 'UserGlobals', className: 'Array' });
    });
  });

});
