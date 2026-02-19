import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['Globals', 'UserGlobals']),
  getDictionaryEntries: vi.fn(() => [
    { isClass: true, category: 'Collections', name: 'Array' },
  ]),
  getClassEnvironments: vi.fn(() => [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:', 'size'] },
    { isMeta: false, envId: 0, category: 'testing', selectors: ['isEmpty'] },
  ]),
  recategorizeMethod: vi.fn(),
  moveClass: vi.fn(),
  reclassifyClass: vi.fn(),
}));

import { DataTransfer, DataTransferItem } from '../__mocks__/vscode';
import { BrowserTreeProvider, BrowserNode } from '../browserTreeProvider';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';

const TREE_MIME = 'application/vnd.code.tree.gemstonebrowser';

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

function makeMethod(overrides: Partial<BrowserNode & { kind: 'method' }> = {}): BrowserNode {
  return {
    kind: 'method',
    sessionId: 1,
    dictIndex: 1,
    dictName: 'Globals',
    className: 'Array',
    isMeta: false,
    environmentId: 0,
    category: 'accessing',
    selector: 'at:',
    ...overrides,
  };
}

function makeClass(overrides: Partial<BrowserNode & { kind: 'class' }> = {}): BrowserNode {
  return {
    kind: 'class',
    sessionId: 1,
    dictIndex: 1,
    dictName: 'Globals',
    name: 'Array',
    ...overrides,
  };
}

describe('BrowserTreeProvider drag and drop', () => {
  let provider: BrowserTreeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BrowserTreeProvider(makeSessionManager(true));
  });

  describe('handleDrag', () => {
    it('sets data for method nodes', () => {
      const dt = new DataTransfer();
      const methods = [makeMethod()];
      provider.handleDrag(methods, dt);
      expect(dt.get(TREE_MIME)).toBeDefined();
      expect(dt.get(TREE_MIME)!.value).toBe(methods);
    });

    it('sets data for class nodes', () => {
      const dt = new DataTransfer();
      const classes = [makeClass()];
      provider.handleDrag(classes, dt);
      expect(dt.get(TREE_MIME)).toBeDefined();
      expect(dt.get(TREE_MIME)!.value).toBe(classes);
    });

    it('rejects mixed node types', () => {
      const dt = new DataTransfer();
      provider.handleDrag([makeMethod(), makeClass()], dt);
      expect(dt.get(TREE_MIME)).toBeUndefined();
    });

    it('rejects non-draggable node types', () => {
      const dt = new DataTransfer();
      const dict: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      provider.handleDrag([dict], dt);
      expect(dt.get(TREE_MIME)).toBeUndefined();
    });
  });

  describe('handleDrop — methods onto categories', () => {
    it('calls recategorizeMethod for valid drop', async () => {
      const method = makeMethod({ category: 'accessing', selector: 'at:' });
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).toHaveBeenCalledWith(
        expect.anything(), 'Array', false, 'at:', 'testing',
      );
    });

    it('moves multiple methods at once', async () => {
      const m1 = makeMethod({ selector: 'at:' });
      const m2 = makeMethod({ selector: 'size' });
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([m1, m2]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).toHaveBeenCalledTimes(2);
    });

    it('skips methods already in target category', async () => {
      const method = makeMethod({ category: 'testing', selector: 'isEmpty' });
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('rejects drop on ** ALL METHODS ** category', async () => {
      const method = makeMethod();
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: '** ALL METHODS **',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('skips methods from different class', async () => {
      const method = makeMethod({ className: 'String' });
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('skips methods from different side (isMeta)', async () => {
      const method = makeMethod({ isMeta: true });
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('skips methods from different environment', async () => {
      const method = makeMethod({ environmentId: 1 });
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });
  });

  describe('handleDrop — classes onto dictionaries', () => {
    it('calls moveClass for valid drop', async () => {
      const cls = makeClass({ dictName: 'Globals', name: 'Array' });
      const target: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 2, name: 'UserGlobals' };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([cls]));

      await provider.handleDrop(target, dt);
      expect(queries.moveClass).toHaveBeenCalledWith(
        expect.anything(), 1, 2, 'Array',
      );
    });

    it('skips classes already in target dictionary', async () => {
      const cls = makeClass({ dictIndex: 1, dictName: 'Globals' });
      const target: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([cls]));

      await provider.handleDrop(target, dt);
      expect(queries.moveClass).not.toHaveBeenCalled();
    });
  });

  describe('handleDrop — classes onto class categories', () => {
    it('calls reclassifyClass for valid drop', async () => {
      const cls = makeClass({ name: 'Array', dictName: 'Globals' });
      const target: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: 'Kernel',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([cls]));

      await provider.handleDrop(target, dt);
      expect(queries.reclassifyClass).toHaveBeenCalledWith(
        expect.anything(), 1, 'Array', 'Kernel',
      );
    });

    it('passes the class dictIndex, not the target dictIndex', async () => {
      const cls = makeClass({ name: 'PrettyWriteStream', dictIndex: 3, dictName: 'PythonAst' });
      const target: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 3, dictName: 'PythonAst', name: 'Parser',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([cls]));

      await provider.handleDrop(target, dt);
      expect(queries.reclassifyClass).toHaveBeenCalledWith(
        expect.anything(), 3, 'PrettyWriteStream', 'Parser',
      );
    });

    it('rejects drop on ** ALL CLASSES ** class category', async () => {
      const cls = makeClass();
      const target: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** ALL CLASSES **',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([cls]));

      await provider.handleDrop(target, dt);
      expect(queries.reclassifyClass).not.toHaveBeenCalled();
    });

    it('rejects drop on ** OTHER GLOBALS ** class category', async () => {
      const cls = makeClass();
      const target: BrowserNode = {
        kind: 'classCategory', sessionId: 1, dictIndex: 1, dictName: 'Globals', name: '** OTHER GLOBALS **',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([cls]));

      await provider.handleDrop(target, dt);
      expect(queries.reclassifyClass).not.toHaveBeenCalled();
    });
  });

  describe('handleDrop — edge cases', () => {
    it('does nothing when no session', async () => {
      const noSessionProvider = new BrowserTreeProvider(makeSessionManager(false));
      const method = makeMethod();
      const target: BrowserNode = {
        kind: 'category', sessionId: 1, dictIndex: 1, dictName: 'Globals',
        className: 'Array', isMeta: false, environmentId: 0, name: 'testing',
      };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await noSessionProvider.handleDrop(target, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('does nothing when target is undefined', async () => {
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([makeMethod()]));

      await provider.handleDrop(undefined as unknown as BrowserNode, dt);
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });

    it('does nothing for incompatible source/target combinations', async () => {
      const method = makeMethod();
      const target: BrowserNode = { kind: 'dictionary', sessionId: 1, dictIndex: 1, name: 'Globals' };
      const dt = new DataTransfer();
      dt.set(TREE_MIME, new DataTransferItem([method]));

      await provider.handleDrop(target, dt);
      expect(queries.moveClass).not.toHaveBeenCalled();
      expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    });
  });
});
