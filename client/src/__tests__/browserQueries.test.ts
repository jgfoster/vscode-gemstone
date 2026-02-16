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

function createMockSession(): ActiveSession {
  const mockGci = {
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsPerform: vi.fn(() => ({ result: 2000n, err: { ...noErr } })),
    GciTsNewString: vi.fn(() => ({ result: 3000n, err: { ...noErr } })),
    GciTsNewSymbol: vi.fn(() => ({ result: 4000n, err: { ...noErr } })),
    GciTsCompileMethod: vi.fn(() => ({ result: 5000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: '', err: { ...noErr } })),
    GciTsPerformFetchBytes: vi.fn(() => ({ data: '', err: { ...noErr } })),
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
});
