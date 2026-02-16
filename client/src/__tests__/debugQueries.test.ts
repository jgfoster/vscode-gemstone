import { describe, it, expect, vi } from 'vitest';
import { OOP_ILLEGAL } from '../gciConstants';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as debug from '../debugQueries';

const noErr = { number: 0, message: '', context: 0n, category: 0, fatal: false, argCount: 0, exceptionObj: 0n, args: [] };
const METHOD_OOP = 5000n;
const CLASS_OOP = 6000n;
const RECEIVER_OOP = 7000n;

/**
 * Creates a mock GCI that behaves like GemStone: single-word selectors work,
 * multi-word selectors (containing spaces) cause "does not understand" errors.
 *
 * This catches a class of bugs where GciTsPerform / GciTsPerformFetchBytes
 * are called with chained unary messages like 'inClass name' instead of
 * sending each message separately.
 */
function createMockSession(): ActiveSession {
  const mockGci = {
    GciTsPerform: vi.fn(
      (handle: unknown, receiver: bigint, selectorOop: bigint, selectorStr: string | null, args: bigint[]) => {
        if (selectorStr && selectorStr.includes(' ')) {
          return {
            result: 0n,
            err: { ...noErr, number: 2010, message: `a ${receiverClassName(receiver)} does not understand #'${selectorStr}'` },
          };
        }
        if (selectorStr === 'inClass' && receiver === METHOD_OOP) {
          return { result: CLASS_OOP, err: { ...noErr } };
        }
        if (selectorStr === 'class') {
          return { result: CLASS_OOP, err: { ...noErr } };
        }
        if (selectorStr === 'allInstVarNames') {
          return { result: 8000n, err: { ...noErr } };
        }
        return { result: 0n, err: { ...noErr } };
      },
    ),
    GciTsPerformFetchBytes: vi.fn(
      (handle: unknown, receiver: bigint, selector: string, args: bigint[], maxBytes: number) => {
        if (selector.includes(' ')) {
          return {
            data: '',
            err: { ...noErr, number: 2010, message: `a ${receiverClassName(receiver)} does not understand #'${selector}'` },
          };
        }
        if (selector === 'name' && receiver === CLASS_OOP) {
          return { data: 'SmallInteger', err: { ...noErr } };
        }
        if (selector === 'selector' && receiver === METHOD_OOP) {
          return { data: 'sizee', err: { ...noErr } };
        }
        if (selector === 'asString') {
          return { data: 'instVarName', err: { ...noErr } };
        }
        return { data: '', err: { ...noErr } };
      },
    ),
    GciTsFetchSize: vi.fn(() => ({ result: 0n, err: { ...noErr } })),
    GciTsFetchOops: vi.fn(() => ({ oops: [], err: { ...noErr } })),
    GciTsOopIsSpecial: vi.fn(() => false),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

function receiverClassName(oop: bigint): string {
  if (oop === METHOD_OOP) return 'GsNMethod';
  if (oop === CLASS_OOP) return 'Metaclass';
  return 'Object';
}

describe('debugQueries', () => {
  describe('getMethodInfo', () => {
    it('returns class name and selector by chaining single-message sends', () => {
      const session = createMockSession();
      const result = debug.getMethodInfo(session, METHOD_OOP);

      expect(result.className).toBe('SmallInteger');
      expect(result.selector).toBe('sizee');
    });

    it('does not send multi-word selectors to GciTsPerformFetchBytes', () => {
      const session = createMockSession();
      debug.getMethodInfo(session, METHOD_OOP);

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });

  describe('getObjectClassName', () => {
    it('returns class name by chaining single-message sends', () => {
      const session = createMockSession();
      const result = debug.getObjectClassName(session, RECEIVER_OOP);

      expect(result).toBe('SmallInteger');
    });

    it('does not send multi-word selectors', () => {
      const session = createMockSession();
      debug.getObjectClassName(session, RECEIVER_OOP);

      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of performCalls) {
        const selectorStr = call[3] as string | null;
        if (selectorStr) expect(selectorStr).not.toContain(' ');
      }

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });

  describe('getInstVarNames', () => {
    it('does not send multi-word selectors', () => {
      const session = createMockSession();
      debug.getInstVarNames(session, RECEIVER_OOP);

      const performCalls = (session.gci.GciTsPerform as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of performCalls) {
        const selectorStr = call[3] as string | null;
        if (selectorStr) expect(selectorStr).not.toContain(' ');
      }

      const fetchBytesCalls = (session.gci.GciTsPerformFetchBytes as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of fetchBytesCalls) {
        const selector = call[2] as string;
        expect(selector).not.toContain(' ');
      }
    });
  });
});
