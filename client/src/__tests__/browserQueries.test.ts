import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OOP_ILLEGAL, OOP_NIL } from '../gciConstants';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';

const noErr = { number: 0, message: '', context: 0n, category: 0, fatal: false, argCount: 0, exceptionObj: 0n, args: [] };

function createMockSession(executeFetchData = ''): ActiveSession {
  const mockGci = {
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsPerform: vi.fn(() => ({ result: 2000n, err: { ...noErr } })),
    GciTsNewString: vi.fn(() => ({ result: 3000n, err: { ...noErr } })),
    GciTsNewSymbol: vi.fn(() => ({ result: 4000n, err: { ...noErr } })),
    GciTsCompileMethod: vi.fn(() => ({ result: 5000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: executeFetchData, err: { ...noErr } })),
    GciTsPerformFetchBytes: vi.fn(() => ({ data: '', err: { ...noErr } })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
    GciTsClearStack: vi.fn(),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

describe('browserQueries', () => {
  describe('compileMethod - class side (isMeta=true)', () => {
    it('passes OOP_ILLEGAL (not OOP_NIL) as selector OOP to GciTsPerform', () => {
      const session = createMockSession();

      queries.compileMethod(session, 'Array', true, 'test', 'testMethod\n  ^ 42');

      // When isMeta is true, compileMethod calls GciTsPerform to send #class
      // The second argument after session.handle is the selector OOP.
      // Per the C API: "Either selector == OOP_ILLEGAL and selectorStr is used,
      // or else selectorStr == NULL and selector is used."
      // So when passing a string selector ('class'), the selector OOP MUST be OOP_ILLEGAL.
      const mockPerform = session.gci.GciTsPerform as ReturnType<typeof vi.fn>;
      expect(mockPerform).toHaveBeenCalledTimes(1);

      const callArgs = mockPerform.mock.calls[0];
      // callArgs: [handle, receiver, selectorOop, selectorStr, args, flags, envId]
      const selectorOop = callArgs[2];
      const selectorStr = callArgs[3];

      expect(selectorStr).toBe('class');
      expect(selectorOop).toBe(OOP_ILLEGAL);
      // Verify it's NOT using OOP_NIL (which was the bug)
      expect(selectorOop).not.toBe(OOP_NIL);
    });

    it('does not call GciTsPerform when isMeta is false', () => {
      const session = createMockSession();

      queries.compileMethod(session, 'Array', false, 'test', 'testMethod\n  ^ 42');

      const mockPerform = session.gci.GciTsPerform as ReturnType<typeof vi.fn>;
      expect(mockPerform).not.toHaveBeenCalled();
    });
  });

  describe('sendersOf', () => {
    it('parses tab-separated GsNMethod results', () => {
      const payload = 'Globals\tArray\t0\tsize\taccessing\nUserGlobals\tMyClass\t1\tprintOn:\tprinting\n';
      const session = createMockSession(payload);

      const results = queries.sendersOf(session, 'size');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'size',
        category: 'accessing',
      });
      expect(results[1]).toEqual({
        dictName: 'UserGlobals',
        className: 'MyClass',
        isMeta: true,
        selector: 'printOn:',
        category: 'printing',
      });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.sendersOf(session, 'nonExistent')).toEqual([]);
    });

    it('passes environmentId to Smalltalk code', () => {
      const session = createMockSession('');
      queries.sendersOf(session, 'size', 2);

      const mockExec = session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('environmentId: 2');
    });
  });

  describe('implementorsOf', () => {
    it('parses tab-separated GsNMethod results', () => {
      const payload = 'Globals\tArray\t0\tsize\taccessing\n';
      const session = createMockSession(payload);

      const results = queries.implementorsOf(session, 'size');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'size',
        category: 'accessing',
      });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.implementorsOf(session, 'nonExistent')).toEqual([]);
    });

    it('uses asArray to handle non-Array collections', () => {
      const session = createMockSession('');
      queries.implementorsOf(session, 'size');

      const mockExec = session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>;
      const code = mockExec.mock.calls[0][1] as string;
      expect(code).toContain('asArray');
    });
  });

  describe('getClassHierarchy', () => {
    it('parses superclass/self/subclass entries', () => {
      const payload = 'Globals\tObject\tsuperclass\nGlobals\tSequenceableCollection\tsuperclass\nGlobals\tArray\tself\nGlobals\tFoo\tsubclass\n';
      const session = createMockSession(payload);

      const results = queries.getClassHierarchy(session, 'Array');

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual({ dictName: 'Globals', className: 'Object', kind: 'superclass' });
      expect(results[1]).toEqual({ dictName: 'Globals', className: 'SequenceableCollection', kind: 'superclass' });
      expect(results[2]).toEqual({ dictName: 'Globals', className: 'Array', kind: 'self' });
      expect(results[3]).toEqual({ dictName: 'Globals', className: 'Foo', kind: 'subclass' });
    });

    it('returns empty array for no results', () => {
      const session = createMockSession('');
      expect(queries.getClassHierarchy(session, 'NonExistent')).toEqual([]);
    });
  });

  describe('searchMethodSource', () => {
    it('parses tab-separated method results', () => {
      const payload = 'Globals\tString\t0\tsubarray\taccessing\n';
      const session = createMockSession(payload);

      const results = queries.searchMethodSource(session, 'subarray', true);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dictName: 'Globals',
        className: 'String',
        isMeta: false,
        selector: 'subarray',
        category: 'accessing',
      });
    });
  });
});
