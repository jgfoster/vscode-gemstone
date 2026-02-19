import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../debugQueries', () => ({
  getObjectPrintString: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return 'a UserProfileSet';
    if (oop === 200n) return 'an Array';
    if (oop === 300n) return 'SystemUser';
    if (oop === 0x14n) return 'nil';
    return `OOP(${oop})`;
  }),
  getObjectClassName: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return 'UserProfileSet';
    if (oop === 200n) return 'Array';
    if (oop === 300n) return 'UserProfile';
    if (oop === 0x14n) return 'UndefinedObject';
    return 'Object';
  }),
  isSpecialOop: vi.fn((_s: unknown, oop: bigint) => {
    // SmallIntegers and nil are special
    return oop === 0x14n || oop === 42n;
  }),
  getInstVarNames: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return ['list', 'maxSize'];
    if (oop === 200n) return [];
    return [];
  }),
  getNamedInstVarOops: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 100n) return [200n, 42n];
    return [];
  }),
  getIndexedSize: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 200n) return 2;
    return 0;
  }),
  getIndexedOops: vi.fn((_s: unknown, oop: bigint) => {
    if (oop === 200n) return [300n, 300n];
    return [];
  }),
}));

import { TreeItemCollapsibleState, ThemeIcon } from '../__mocks__/vscode';
import { InspectorTreeProvider, InspectorNode } from '../inspectorTreeProvider';
import { SessionManager } from '../sessionManager';

function makeSessionManager(hasSession: boolean) {
  return {
    getSession: vi.fn((id: number) =>
      hasSession
        ? { id, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('InspectorTreeProvider', () => {
  describe('root management', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('starts with an empty tree', () => {
      expect(provider.getChildren()).toEqual([]);
    });

    it('addRoot adds a root node and fires change event', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.addRoot(1, 100n, 'AllUsers');

      const roots = provider.getChildren();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({
        sessionId: 1, oop: 100n, label: 'AllUsers', isRoot: true, kind: 'root',
      });
      expect(listener).toHaveBeenCalled();
    });

    it('removeRoot removes a specific root', () => {
      provider.addRoot(1, 100n, 'AllUsers');
      provider.addRoot(1, 200n, 'SomeArray');

      const roots = provider.getChildren();
      expect(roots).toHaveLength(2);

      provider.removeRoot(roots[0]);
      const remaining = provider.getChildren();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].label).toBe('SomeArray');
    });

    it('clearAll removes all roots', () => {
      provider.addRoot(1, 100n, 'AllUsers');
      provider.addRoot(1, 200n, 'SomeArray');
      expect(provider.getChildren()).toHaveLength(2);

      provider.clearAll();
      expect(provider.getChildren()).toEqual([]);
    });

    it('removeSessionItems removes items for a specific session', () => {
      provider.addRoot(1, 100n, 'FromSession1');
      provider.addRoot(2, 200n, 'FromSession2');
      provider.addRoot(1, 300n, 'AlsoSession1');

      provider.removeSessionItems(1);
      const remaining = provider.getChildren();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].label).toBe('FromSession2');
    });

    it('removeSessionItems does not fire event if no items removed', () => {
      provider.addRoot(1, 100n, 'FromSession1');
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.removeSessionItems(999);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getTreeItem', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('renders a root node with eye icon and description from printString', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 100n, label: 'AllUsers', isRoot: true, kind: 'root',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('AllUsers');
      expect(item.description).toBe('a UserProfileSet');
      expect(item.tooltip).toBe('UserProfileSet: a UserProfileSet');
      expect((item.iconPath as ThemeIcon).id).toBe('eye');
      expect(item.contextValue).toBe('gemstoneInspectorRoot');
      // Has named instVars → collapsed
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it('renders a named child node with symbol-field icon', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 200n, label: 'list', isRoot: false, kind: 'named',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('list');
      expect(item.description).toBe('an Array');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-field');
      expect(item.contextValue).toBe('gemstoneInspectorItem');
      // Has indexed elements → collapsed
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it('renders an indexed child node with symbol-array icon', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 300n, label: '[1]', isRoot: false, kind: 'indexed',
      };
      const item = provider.getTreeItem(node);
      expect(item.label).toBe('[1]');
      expect((item.iconPath as ThemeIcon).id).toBe('symbol-array');
    });

    it('renders a special (leaf) OOP as non-expandable', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 42n, label: 'maxSize', isRoot: false, kind: 'named',
      };
      const item = provider.getTreeItem(node);
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it('renders nil as non-expandable', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 0x14n, label: 'value', isRoot: false, kind: 'named',
      };
      const item = provider.getTreeItem(node);
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(item.description).toBe('nil');
    });

    it('shows disconnected state when session is gone', () => {
      const disconnectedProvider = new InspectorTreeProvider(makeSessionManager(false));
      const node: InspectorNode = {
        sessionId: 1, oop: 100n, label: 'AllUsers', isRoot: true, kind: 'root',
      };
      const item = disconnectedProvider.getTreeItem(node);
      expect(item.description).toBe('<session disconnected>');
      expect((item.iconPath as ThemeIcon).id).toBe('warning');
      expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
  });

  describe('getChildren (drill-down)', () => {
    let provider: InspectorTreeProvider;

    beforeEach(() => {
      provider = new InspectorTreeProvider(makeSessionManager(true));
    });

    it('returns named instVars for an object with named fields', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 100n, label: 'AllUsers', isRoot: true, kind: 'root',
      };
      const children = provider.getChildren(node);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        label: 'list', oop: 200n, kind: 'named', isRoot: false,
      });
      expect(children[1]).toMatchObject({
        label: 'maxSize', oop: 42n, kind: 'named', isRoot: false,
      });
    });

    it('returns indexed elements for an array-like object', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 200n, label: 'list', isRoot: false, kind: 'named',
      };
      const children = provider.getChildren(node);
      // Array has no named instVars (mock returns []), but 2 indexed elements
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({
        label: '[1]', oop: 300n, kind: 'indexed', isRoot: false,
      });
      expect(children[1]).toMatchObject({
        label: '[2]', oop: 300n, kind: 'indexed', isRoot: false,
      });
    });

    it('returns empty for a special OOP', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 42n, label: 'maxSize', isRoot: false, kind: 'named',
      };
      expect(provider.getChildren(node)).toEqual([]);
    });

    it('returns empty for nil', () => {
      const node: InspectorNode = {
        sessionId: 1, oop: 0x14n, label: 'value', isRoot: false, kind: 'named',
      };
      expect(provider.getChildren(node)).toEqual([]);
    });

    it('returns empty when session is disconnected', () => {
      const disconnectedProvider = new InspectorTreeProvider(makeSessionManager(false));
      const node: InspectorNode = {
        sessionId: 1, oop: 100n, label: 'AllUsers', isRoot: true, kind: 'root',
      };
      expect(disconnectedProvider.getChildren(node)).toEqual([]);
    });
  });
});
