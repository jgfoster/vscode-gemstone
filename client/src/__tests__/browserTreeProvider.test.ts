import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

// Mock browserQueries so no GCI connection is needed
vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['Globals', 'UserGlobals']),
  getClassNames: vi.fn(() => ['Array', 'String']),
  getDictionaryEntries: vi.fn(() => [
    { isClass: true, category: 'Collections', name: 'Array' },
    { isClass: true, category: 'Collections', name: 'String' },
    { isClass: true, category: 'Kernel', name: 'Object' },
    { isClass: false, category: '', name: 'AllUsers' },
    { isClass: false, category: '', name: 'UserGlobals' },
  ]),
  getMethodCategories: vi.fn(() => ['accessing', 'testing']),
  getMethodSelectors: vi.fn(() => ['at:', 'size']),
  getClassEnvironments: vi.fn(() => [
    { isMeta: true, envId: 0, category: 'creation', selectors: ['new'] },
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:', 'size'] },
    { isMeta: false, envId: 0, category: 'testing', selectors: ['isEmpty'] },
    { isMeta: false, envId: 1, category: 'python', selectors: ['__getitem__', '__len__'] },
  ]),
}));

import { TreeItemCollapsibleState, ThemeIcon, Uri, __setConfig, __resetConfig } from '../__mocks__/vscode';
import { BrowserTreeProvider, BrowserNode } from '../browserTreeProvider';
import { SessionManager } from '../sessionManager';

// Minimal mock session manager
function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() =>
      hasSession
        ? { id: 1, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('BrowserTreeProvider', () => {
  afterEach(() => {
    __resetConfig();
  });

  describe('with no session', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(false));
    });

    it('returns empty array for root when no session selected', async () => {
      const children = await provider.getChildren();
      expect(children).toEqual([]);
    });
  });

  describe('with active session (maxEnvironment=0)', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('returns dictionary nodes at root', async () => {
      const children = await provider.getChildren();
      expect(children).toHaveLength(2);
      expect(children[0]).toEqual({
        kind: 'dictionary',
        sessionId: 1,
        dictIndex: 1,
        name: 'Globals',
      });
      expect(children[1]).toEqual({
        kind: 'dictionary',
        sessionId: 1,
        dictIndex: 2,
        name: 'UserGlobals',
      });
    });

    it('returns class category nodes under a dictionary with ** ALL CLASSES ** first and ** OTHER GLOBALS ** last', async () => {
      const dict: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      const children = await provider.getChildren(dict);
      expect(children).toHaveLength(4);
      expect(children[0]).toMatchObject({ kind: 'classCategory', name: '** ALL CLASSES **', dictName: 'Globals' });
      expect(children[1]).toMatchObject({ kind: 'classCategory', name: 'Collections', dictName: 'Globals' });
      expect(children[2]).toMatchObject({ kind: 'classCategory', name: 'Kernel', dictName: 'Globals' });
      expect(children[3]).toMatchObject({ kind: 'classCategory', name: '** OTHER GLOBALS **', dictName: 'Globals' });
    });

    it('returns all classes sorted under ** ALL CLASSES ** class category', async () => {
      const dict: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      await provider.getChildren(dict);

      const allCat: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** ALL CLASSES **',
      };
      const children = await provider.getChildren(allCat);
      expect(children).toHaveLength(3);
      expect(children[0]).toMatchObject({ kind: 'class', name: 'Array', dictName: 'Globals' });
      expect(children[1]).toMatchObject({ kind: 'class', name: 'Object', dictName: 'Globals' });
      expect(children[2]).toMatchObject({ kind: 'class', name: 'String', dictName: 'Globals' });
    });

    it('returns filtered classes under a specific class category', async () => {
      const dict: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      await provider.getChildren(dict);

      const collCat: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Collections',
      };
      const children = await provider.getChildren(collCat);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'class', name: 'Array' });
      expect(children[1]).toMatchObject({ kind: 'class', name: 'String' });
    });

    it('returns sorted globals under ** OTHER GLOBALS **', async () => {
      const dict: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      await provider.getChildren(dict);

      const globalsCat: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** OTHER GLOBALS **',
      };
      const children = await provider.getChildren(globalsCat);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'global', name: 'AllUsers' });
      expect(children[1]).toMatchObject({ kind: 'global', name: 'UserGlobals' });
    });

    it('returns definition, comment, instance, and class under a class', async () => {
      const cls: BrowserNode = { kind: 'class', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Array' };
      const children = await provider.getChildren(cls);
      expect(children).toHaveLength(4);
      expect(children[0]).toMatchObject({ kind: 'definition', className: 'Array' });
      expect(children[1]).toMatchObject({ kind: 'comment', className: 'Array' });
      expect(children[2]).toMatchObject({ kind: 'side', isMeta: false, environmentId: 0 });
      expect(children[3]).toMatchObject({ kind: 'side', isMeta: true, environmentId: 0 });
    });

    it('returns method category nodes under a side with ** ALL METHODS ** first', async () => {
      const side: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array', isMeta: false,
        environmentId: 0,
      };
      const children = await provider.getChildren(side);
      expect(children).toHaveLength(3);
      expect(children[0]).toMatchObject({ kind: 'category', name: '** ALL METHODS **', environmentId: 0 });
      expect(children[1]).toMatchObject({ kind: 'category', name: 'accessing', environmentId: 0 });
      expect(children[2]).toMatchObject({ kind: 'category', name: 'testing', environmentId: 0 });
    });

    it('returns all methods sorted alphabetically under ** ALL METHODS **', async () => {
      const cat: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, name: '** ALL METHODS **', environmentId: 0,
      };
      const children = await provider.getChildren(cat);
      expect(children).toHaveLength(3);
      expect(children[0]).toMatchObject({ kind: 'method', selector: 'at:', category: 'accessing' });
      expect(children[1]).toMatchObject({ kind: 'method', selector: 'isEmpty', category: 'testing' });
      expect(children[2]).toMatchObject({ kind: 'method', selector: 'size', category: 'accessing' });
    });

    it('returns method nodes under a category', async () => {
      const cat: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, name: 'accessing', environmentId: 0,
      };
      const children = await provider.getChildren(cat);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'method', selector: 'at:', environmentId: 0 });
      expect(children[1]).toMatchObject({ kind: 'method', selector: 'size', environmentId: 0 });
    });

    it('returns empty array for leaf nodes', async () => {
      const method: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, category: 'accessing', selector: 'at:',
        environmentId: 0,
      };
      expect(await provider.getChildren(method)).toEqual([]);

      const def: BrowserNode = { kind: 'definition', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      expect(await provider.getChildren(def)).toEqual([]);

      const comment: BrowserNode = { kind: 'comment', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      expect(await provider.getChildren(comment)).toEqual([]);

      const global: BrowserNode = { kind: 'global', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'AllUsers' };
      expect(await provider.getChildren(global)).toEqual([]);
    });
  });

  describe('with active session (maxEnvironment=2)', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      __setConfig('gemstone', 'maxEnvironment', 2);
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('returns 8 children under a class (def, comment, inst 0-2, class 0-2)', async () => {
      const cls: BrowserNode = { kind: 'class', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Array' };
      const children = await provider.getChildren(cls);
      expect(children).toHaveLength(8);
      expect(children[0]).toMatchObject({ kind: 'definition' });
      expect(children[1]).toMatchObject({ kind: 'comment' });
      expect(children[2]).toMatchObject({ kind: 'side', isMeta: false, environmentId: 0 });
      expect(children[3]).toMatchObject({ kind: 'side', isMeta: false, environmentId: 1 });
      expect(children[4]).toMatchObject({ kind: 'side', isMeta: false, environmentId: 2 });
      expect(children[5]).toMatchObject({ kind: 'side', isMeta: true, environmentId: 0 });
      expect(children[6]).toMatchObject({ kind: 'side', isMeta: true, environmentId: 1 });
      expect(children[7]).toMatchObject({ kind: 'side', isMeta: true, environmentId: 2 });
    });

    it('returns categories from env cache for a specific environment', async () => {
      const side: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 1,
      };
      const children = await provider.getChildren(side);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'category', name: '** ALL METHODS **', environmentId: 1 });
      expect(children[1]).toMatchObject({ kind: 'category', name: 'python', environmentId: 1 });
    });

    it('returns selectors from env cache', async () => {
      const cat: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, name: 'python', environmentId: 1,
      };
      const children = await provider.getChildren(cat);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'method', selector: '__getitem__', environmentId: 1 });
      expect(children[1]).toMatchObject({ kind: 'method', selector: '__len__', environmentId: 1 });
    });

    it('returns only ** ALL METHODS ** for an environment with no methods', async () => {
      const side: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: true, environmentId: 2,
      };
      const children = await provider.getChildren(side);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ kind: 'category', name: '** ALL METHODS **' });
    });

    it('returns all methods from ** ALL METHODS ** for env 1', async () => {
      const cat: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, name: '** ALL METHODS **', environmentId: 1,
      };
      const children = await provider.getChildren(cat);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'method', selector: '__getitem__', category: 'python' });
      expect(children[1]).toMatchObject({ kind: 'method', selector: '__len__', category: 'python' });
    });

    it('returns empty methods from ** ALL METHODS ** for env with no methods', async () => {
      const cat: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: true, name: '** ALL METHODS **', environmentId: 2,
      };
      const children = await provider.getChildren(cat);
      expect(children).toHaveLength(0);
    });
  });

  describe('getTreeItem', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('renders a dictionary node', () => {
      const node: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('Globals');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-namespace');
      expect(item.contextValue).toBe('gemstoneDictionary');
    });

    it('renders a named class category node', () => {
      const node: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Collections',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('Collections');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-folder');
      expect(item.contextValue).toBe('gemstoneClassCategoryNamed');
    });

    it('renders ** ALL CLASSES ** class category as virtual', () => {
      const node: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** ALL CLASSES **',
      };
      const item = provider.getTreeItem(node);
      expect(item.contextValue).toBe('gemstoneClassCategory');
    });

    it('renders a class node', () => {
      const node: BrowserNode = { kind: 'class', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Array' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('Array');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-class');
      expect(item.contextValue).toBe('gemstoneClass');
    });

    it('renders a definition node as a leaf with command', () => {
      const node: BrowserNode = { kind: 'definition', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('definition');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-structure');
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('gemstone.openDocument');
    });

    it('renders a comment node as a leaf with command', () => {
      const node: BrowserNode = { kind: 'comment', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('comment');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect((item.iconPath as ThemeIcon).id).toBe('comment');
      expect(item.command).toBeDefined();
    });

    it('renders instance side node without env number when maxEnv=0', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array', isMeta: false,
        environmentId: 0,
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('instance');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-method');
    });

    it('renders class side node without env number when maxEnv=0', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array', isMeta: true,
        environmentId: 0,
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('class');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-interface');
    });

    it('renders side node with env number when maxEnv > 0', () => {
      __setConfig('gemstone', 'maxEnvironment', 2);
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array', isMeta: false,
        environmentId: 1,
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('instance 1');
    });

    it('renders a method node as a leaf with gemstone:// URI command', () => {
      const node: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, category: 'accessing', selector: 'at:put:',
        environmentId: 0,
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('at:put:');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('gemstone.openDocument');
      // URI should contain the selector
      const uri = item.command!.arguments![0];
      expect(uri.scheme).toBe('gemstone');
      expect(uri.authority).toBe('1');
      expect(uri.path).toContain('at%3Aput%3A');
      expect(uri.query).toBe('');
    });

    it('renders a method node with ?env= query param when environmentId > 0', () => {
      const node: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, category: 'python', selector: '__len__',
        environmentId: 2,
      };
      const item = provider.getTreeItem(node);
      const uri = item.command!.arguments![0];
      expect(uri.query).toBe('env=2');
    });

    it('renders a global node as a leaf with symbol-variable icon', () => {
      const node: BrowserNode = {
        kind: 'global', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'AllUsers',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('AllUsers');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-variable');
      expect(item.contextValue).toBe('gemstoneGlobal');
      expect(item.command).toMatchObject({
        command: 'gemstone.inspectGlobal',
        arguments: [node],
      });
    });
  });

  describe('getTreeItem sets id (nodeId)', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('dictionary id', () => {
      const node: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      expect(provider.getTreeItem(node).id).toBe('dict/1/Globals');
    });

    it('classCategory id', () => {
      const node: BrowserNode = { kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** ALL CLASSES **' };
      expect(provider.getTreeItem(node).id).toBe('classcat/1/Globals/** ALL CLASSES **');
    });

    it('class id', () => {
      const node: BrowserNode = { kind: 'class', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Array' };
      expect(provider.getTreeItem(node).id).toBe('class/1/Globals/Array');
    });

    it('definition id', () => {
      const node: BrowserNode = { kind: 'definition', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      expect(provider.getTreeItem(node).id).toBe('def/1/Globals/Array');
    });

    it('comment id', () => {
      const node: BrowserNode = { kind: 'comment', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      expect(provider.getTreeItem(node).id).toBe('comment/1/Globals/Array');
    });

    it('side id', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0,
      };
      expect(provider.getTreeItem(node).id).toBe('side/1/Globals/Array/0/0');
    });

    it('side id (class side, env 2)', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: true, environmentId: 2,
      };
      expect(provider.getTreeItem(node).id).toBe('side/1/Globals/Array/1/2');
    });

    it('category id', () => {
      const node: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, name: 'accessing',
      };
      expect(provider.getTreeItem(node).id).toBe('mcat/1/Globals/Array/0/0/accessing');
    });

    it('method id', () => {
      const node: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, category: 'accessing', selector: 'at:put:',
      };
      expect(provider.getTreeItem(node).id).toBe('method/1/Globals/Array/0/0/accessing/at:put:');
    });

    it('global id', () => {
      const node: BrowserNode = { kind: 'global', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'AllUsers' };
      expect(provider.getTreeItem(node).id).toBe('global/1/Globals/AllUsers');
    });

    it('id uses dictName not dictIndex', () => {
      const node1: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      const node2: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 5, name: 'Globals' };
      expect(provider.getTreeItem(node1).id).toBe(provider.getTreeItem(node2).id);
    });
  });

  describe('getParent', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('dictionary has no parent', () => {
      const node: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      expect(provider.getParent(node)).toBeNull();
    });

    it('classCategory parent is dictionary', () => {
      const node: BrowserNode = { kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** ALL CLASSES **' };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'dictionary', name: 'Globals' });
    });

    it('class parent is ** ALL CLASSES ** classCategory', () => {
      const node: BrowserNode = { kind: 'class', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Array' };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'classCategory', name: '** ALL CLASSES **', dictName: 'Globals' });
    });

    it('definition parent is class', () => {
      const node: BrowserNode = { kind: 'definition', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'class', name: 'Array' });
    });

    it('comment parent is class', () => {
      const node: BrowserNode = { kind: 'comment', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array' };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'class', name: 'Array' });
    });

    it('side parent is class', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0,
      };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'class', name: 'Array' });
    });

    it('category parent is side', () => {
      const node: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, name: 'accessing',
      };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'side', className: 'Array', isMeta: false, environmentId: 0 });
    });

    it('method parent is category', () => {
      const node: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, category: 'accessing', selector: 'size',
      };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'category', name: 'accessing', className: 'Array' });
    });

    it('global parent is ** OTHER GLOBALS ** classCategory', () => {
      const node: BrowserNode = { kind: 'global', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'AllUsers' };
      const parent = provider.getParent(node);
      expect(parent).toMatchObject({ kind: 'classCategory', name: '** OTHER GLOBALS **' });
    });

    it('method ancestor chain reaches root', () => {
      const method: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, category: 'accessing', selector: 'size',
      };
      const chain: string[] = [];
      let node: BrowserNode | null = method;
      while (node) {
        chain.push(node.kind);
        node = provider.getParent(node);
      }
      expect(chain).toEqual(['method', 'category', 'side', 'class', 'classCategory', 'dictionary']);
    });

    it('parent ids match getTreeItem ids', () => {
      const method: BrowserNode = {
        kind: 'method', sessionId: 1, dictIndex: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, category: 'accessing', selector: 'size',
      };
      // The parent of a method should have an id matching a real category node's id
      const parent = provider.getParent(method)!;
      const realCat: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 99, dictName: 'Globals', className: 'Array',
        isMeta: false, environmentId: 0, name: 'accessing',
      };
      expect(provider.getTreeItem(parent).id).toBe(provider.getTreeItem(realCat).id);
    });
  });

  describe('nodeForUri', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('returns null for non-gemstone URIs', () => {
      const uri = Uri.parse('file:///some/path.gs');
      expect(provider.nodeForUri(uri)).toBeNull();
    });

    it('returns null for short paths', () => {
      const uri = Uri.parse('gemstone://1/Globals');
      expect(provider.nodeForUri(uri)).toBeNull();
    });

    it('returns definition node', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const node = provider.nodeForUri(uri);
      expect(node).toMatchObject({ kind: 'definition', sessionId: 1, dictName: 'Globals', className: 'Array' });
    });

    it('returns comment node', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment');
      const node = provider.nodeForUri(uri);
      expect(node).toMatchObject({ kind: 'comment', sessionId: 1, dictName: 'Globals', className: 'Array' });
    });

    it('returns method node for instance side', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      const node = provider.nodeForUri(uri);
      expect(node).toMatchObject({
        kind: 'method', sessionId: 1, dictName: 'Globals', className: 'Array',
        isMeta: false, category: 'accessing', selector: 'size', environmentId: 0,
      });
    });

    it('returns method node for class side', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new');
      const node = provider.nodeForUri(uri);
      expect(node).toMatchObject({
        kind: 'method', isMeta: true, category: 'creation', selector: 'new',
      });
    });

    it('parses encoded selector', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3Aput%3A');
      const node = provider.nodeForUri(uri);
      expect(node).toMatchObject({ kind: 'method', selector: 'at:put:' });
    });

    it('parses env query parameter', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=2');
      const node = provider.nodeForUri(uri);
      expect(node).toMatchObject({ kind: 'method', environmentId: 2 });
    });

    it('returns null for new-method URIs', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      expect(provider.nodeForUri(uri)).toBeNull();
    });

    it('returns null for new-class URIs', () => {
      const uri = Uri.parse('gemstone://1/Globals/new-class');
      expect(provider.nodeForUri(uri)).toBeNull();
    });

    it('returns null for 5-segment paths', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing');
      expect(provider.nodeForUri(uri)).toBeNull();
    });

    it('nodeForUri stores path-based ID for definition', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const node = provider.nodeForUri(uri)!;
      expect(provider.getTreeItem(node).id).toBe('d:1:Globals/cc:** ALL CLASSES **/c:Array/def');
    });

    it('nodeForUri stores path-based ID for method', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      const node = provider.nodeForUri(uri)!;
      expect(provider.getTreeItem(node).id).toBe(
        'd:1:Globals/cc:** ALL CLASSES **/c:Array/s:0:0/cat:accessing/m:size',
      );
    });

    it('nodeForUri stores path-based ID for class-side method with env', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new?env=2');
      const node = provider.nodeForUri(uri)!;
      expect(provider.getTreeItem(node).id).toBe(
        'd:1:Globals/cc:** ALL CLASSES **/c:Array/s:1:2/cat:creation/m:new',
      );
    });
  });

  describe('path-based IDs', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('getChildren assigns path-based IDs to root dictionaries', async () => {
      const dicts = await provider.getChildren();
      expect(provider.getTreeItem(dicts[0]).id).toBe('d:1:Globals');
      expect(provider.getTreeItem(dicts[1]).id).toBe('d:1:UserGlobals');
    });

    it('same class under ** ALL CLASSES ** and Collections gets different IDs', async () => {
      const dicts = await provider.getChildren();
      const cats = await provider.getChildren(dicts[0]); // dict Globals
      const allCat = cats[0];  // ** ALL CLASSES **
      const collCat = cats[1]; // Collections

      const allClasses = await provider.getChildren(allCat);
      const collClasses = await provider.getChildren(collCat);

      const arrayUnderAll = allClasses.find(c => c.kind === 'class' && c.name === 'Array')!;
      const arrayUnderColl = collClasses.find(c => c.kind === 'class' && c.name === 'Array')!;

      const idAll = provider.getTreeItem(arrayUnderAll).id;
      const idColl = provider.getTreeItem(arrayUnderColl).id;

      expect(idAll).toBe('d:1:Globals/cc:** ALL CLASSES **/c:Array');
      expect(idColl).toBe('d:1:Globals/cc:Collections/c:Array');
      expect(idAll).not.toBe(idColl);
    });

    it('same method under ** ALL METHODS ** and real category gets different IDs', async () => {
      const dicts = await provider.getChildren();
      const cats = await provider.getChildren(dicts[0]);
      const allClasses = await provider.getChildren(cats[0]); // ** ALL CLASSES **
      const arrayNode = allClasses.find(c => c.kind === 'class' && c.name === 'Array')!;
      const sides = await provider.getChildren(arrayNode);
      const instSide = sides.find(s => s.kind === 'side' && !s.isMeta)!;
      const methodCats = await provider.getChildren(instSide);
      const allMCat = methodCats[0]; // ** ALL METHODS ** (method category)
      const accMCat = methodCats.find(c => c.kind === 'category' && c.name === 'accessing')!;

      const allMethods = await provider.getChildren(allMCat);
      const accMethods = await provider.getChildren(accMCat);

      const sizeAll = allMethods.find(m => m.kind === 'method' && m.selector === 'size')!;
      const sizeAcc = accMethods.find(m => m.kind === 'method' && m.selector === 'size')!;

      const idAll = provider.getTreeItem(sizeAll).id;
      const idAcc = provider.getTreeItem(sizeAcc).id;

      expect(idAll).not.toBe(idAcc);
      expect(idAll).toContain('cat:** ALL METHODS **');
      expect(idAcc).toContain('cat:accessing');
    });

    it('nodeForUri path matches getChildren path through ** ALL CLASSES **', async () => {
      // Walk the tree through ** ALL CLASSES ** to get a method
      const dicts = await provider.getChildren();
      const cats = await provider.getChildren(dicts[0]);
      const allClasses = await provider.getChildren(cats[0]); // ** ALL CLASSES **
      const arrayNode = allClasses.find(c => c.kind === 'class' && c.name === 'Array')!;
      const sides = await provider.getChildren(arrayNode);
      const instSide = sides.find(s => s.kind === 'side' && !s.isMeta)!;
      const methodCats = await provider.getChildren(instSide);
      const accCat = methodCats.find(c => c.kind === 'category' && c.name === 'accessing')!;
      const methods = await provider.getChildren(accCat);
      const sizeMethod = methods.find(m => m.kind === 'method' && m.selector === 'size')!;

      const treeId = provider.getTreeItem(sizeMethod).id;

      // Now parse the same method from a URI
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      const fromUri = provider.nodeForUri(uri)!;
      const uriId = provider.getTreeItem(fromUri).id;

      expect(uriId).toBe(treeId);
    });

    it('getParent derives correct parent path from nodeForUri node', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      const method = provider.nodeForUri(uri)!;

      const cat = provider.getParent(method)!;
      expect(provider.getTreeItem(cat).id).toBe(
        'd:1:Globals/cc:** ALL CLASSES **/c:Array/s:0:0/cat:accessing',
      );

      const side = provider.getParent(cat)!;
      expect(provider.getTreeItem(side).id).toBe(
        'd:1:Globals/cc:** ALL CLASSES **/c:Array/s:0:0',
      );

      const cls = provider.getParent(side)!;
      expect(provider.getTreeItem(cls).id).toBe(
        'd:1:Globals/cc:** ALL CLASSES **/c:Array',
      );

      const classCat = provider.getParent(cls)!;
      expect(provider.getTreeItem(classCat).id).toBe(
        'd:1:Globals/cc:** ALL CLASSES **',
      );

      const dict = provider.getParent(classCat)!;
      expect(provider.getTreeItem(dict).id).toBe('d:1:Globals');

      expect(provider.getParent(dict)).toBeNull();
    });
  });

  describe('refresh', () => {
    it('fires onDidChangeTreeData event', () => {
      const provider = new BrowserTreeProvider(makeSessionManager(true));
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalledWith(undefined);
    });
  });
});
