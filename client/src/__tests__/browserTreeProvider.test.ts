import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

// Mock browserQueries so no GCI connection is needed
vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['Globals', 'UserGlobals']),
  getClassNames: vi.fn(() => ['Array', 'String']),
  getMethodCategories: vi.fn(() => ['accessing', 'testing']),
  getMethodSelectors: vi.fn(() => ['at:', 'size']),
}));

import { TreeItemCollapsibleState, ThemeIcon } from '../__mocks__/vscode';
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

  describe('with active session', () => {
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
        name: 'Globals',
      });
      expect(children[1]).toEqual({
        kind: 'dictionary',
        sessionId: 1,
        name: 'UserGlobals',
      });
    });

    it('returns class nodes under a dictionary', async () => {
      const dict: BrowserNode = { kind: 'dictionary', sessionId: 1, name: 'Globals' };
      const children = await provider.getChildren(dict);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'class', name: 'Array', dictName: 'Globals' });
      expect(children[1]).toMatchObject({ kind: 'class', name: 'String', dictName: 'Globals' });
    });

    it('returns definition, comment, instance, and class under a class', async () => {
      const cls: BrowserNode = { kind: 'class', sessionId: 1, dictName: 'Globals', name: 'Array' };
      const children = await provider.getChildren(cls);
      expect(children).toHaveLength(4);
      expect(children[0]).toMatchObject({ kind: 'definition', className: 'Array' });
      expect(children[1]).toMatchObject({ kind: 'comment', className: 'Array' });
      expect(children[2]).toMatchObject({ kind: 'side', isMeta: false });
      expect(children[3]).toMatchObject({ kind: 'side', isMeta: true });
    });

    it('returns category nodes under a side', async () => {
      const side: BrowserNode = {
        kind: 'side', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false,
      };
      const children = await provider.getChildren(side);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'category', name: 'accessing' });
      expect(children[1]).toMatchObject({ kind: 'category', name: 'testing' });
    });

    it('returns method nodes under a category', async () => {
      const cat: BrowserNode = {
        kind: 'category', sessionId: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, name: 'accessing',
      };
      const children = await provider.getChildren(cat);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'method', selector: 'at:' });
      expect(children[1]).toMatchObject({ kind: 'method', selector: 'size' });
    });

    it('returns empty array for leaf nodes', async () => {
      const method: BrowserNode = {
        kind: 'method', sessionId: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, category: 'accessing', selector: 'at:',
      };
      expect(await provider.getChildren(method)).toEqual([]);

      const def: BrowserNode = { kind: 'definition', sessionId: 1, dictName: 'Globals', className: 'Array' };
      expect(await provider.getChildren(def)).toEqual([]);

      const comment: BrowserNode = { kind: 'comment', sessionId: 1, dictName: 'Globals', className: 'Array' };
      expect(await provider.getChildren(comment)).toEqual([]);
    });
  });

  describe('getTreeItem', () => {
    let provider: BrowserTreeProvider;

    beforeEach(() => {
      provider = new BrowserTreeProvider(makeSessionManager(true));
    });

    it('renders a dictionary node', () => {
      const node: BrowserNode = { kind: 'dictionary', sessionId: 1, name: 'Globals' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('Globals');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(item.iconPath).toBeInstanceOf(ThemeIcon);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-namespace');
      expect(item.contextValue).toBe('gemstoneDictionary');
    });

    it('renders a class node', () => {
      const node: BrowserNode = { kind: 'class', sessionId: 1, dictName: 'Globals', name: 'Array' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('Array');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-class');
      expect(item.contextValue).toBe('gemstoneClass');
    });

    it('renders a definition node as a leaf with command', () => {
      const node: BrowserNode = { kind: 'definition', sessionId: 1, dictName: 'Globals', className: 'Array' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('definition');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-structure');
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('vscode.open');
    });

    it('renders a comment node as a leaf with command', () => {
      const node: BrowserNode = { kind: 'comment', sessionId: 1, dictName: 'Globals', className: 'Array' };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('comment');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect((item.iconPath as ThemeIcon).id).toBe('comment');
      expect(item.command).toBeDefined();
    });

    it('renders instance side node', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: false,
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('instance');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-method');
    });

    it('renders class side node', () => {
      const node: BrowserNode = {
        kind: 'side', sessionId: 1, dictName: 'Globals', className: 'Array', isMeta: true,
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('class');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-interface');
    });

    it('renders a method node as a leaf with gemstone:// URI command', () => {
      const node: BrowserNode = {
        kind: 'method', sessionId: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, category: 'accessing', selector: 'at:put:',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('at:put:');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(item.command).toBeDefined();
      expect(item.command!.command).toBe('vscode.open');
      // URI should contain the selector
      const uri = item.command!.arguments![0];
      expect(uri.scheme).toBe('gemstone');
      expect(uri.authority).toBe('1');
      expect(uri.path).toContain('at%3Aput%3A');
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
