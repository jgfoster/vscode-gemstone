import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as sunit from '../sunitQueries';

const noErr = { number: 0, message: '', context: 0n, category: 0, fatal: false, argCount: 0, exceptionObj: 0n, args: [] };

function createMockSession(executeFetchData = ''): ActiveSession {
  const mockGci = {
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: executeFetchData, err: { ...noErr } })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion: '3.7.2',
  };
}

describe('sunitQueries', () => {
  describe('discoverTestClasses', () => {
    it('parses tab-separated dictName/className pairs', () => {
      const session = createMockSession('UserGlobals\tMyTestCase\nGlobals\tOtherTest\n');
      const results = sunit.discoverTestClasses(session);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ dictName: 'UserGlobals', className: 'MyTestCase' });
      expect(results[1]).toEqual({ dictName: 'Globals', className: 'OtherTest' });
    });

    it('returns empty array when no test classes exist', () => {
      const session = createMockSession('');
      expect(sunit.discoverTestClasses(session)).toEqual([]);
    });

    it('executes Smalltalk code that finds TestCase subclasses', () => {
      const session = createMockSession('');
      sunit.discoverTestClasses(session);
      const code = (session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(code).toContain('TestCase');
      expect(code).toContain('isSubclassOf');
    });
  });

  describe('discoverTestMethods', () => {
    it('parses selector and category', () => {
      const session = createMockSession('testAdd\tunit tests\ntestRemove\ttesting\n');
      const results = sunit.discoverTestMethods(session, 'MyTestCase');
      expect(results).toEqual([
        { selector: 'testAdd', category: 'unit tests' },
        { selector: 'testRemove', category: 'testing' },
      ]);
    });

    it('returns empty array when no test methods', () => {
      const session = createMockSession('');
      expect(sunit.discoverTestMethods(session, 'MyTestCase')).toEqual([]);
    });

    it('handles missing category gracefully', () => {
      const session = createMockSession('testFoo\t\n');
      const results = sunit.discoverTestMethods(session, 'MyTestCase');
      expect(results).toEqual([{ selector: 'testFoo', category: '' }]);
    });
  });

  describe('runTestMethod', () => {
    it('parses a passing test result', () => {
      const session = createMockSession('passed\t\t42');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testAdd');
      expect(result).toEqual({
        className: 'MyTestCase',
        selector: 'testAdd',
        status: 'passed',
        message: '',
        durationMs: 42,
      });
    });

    it('parses a failed test result', () => {
      const session = createMockSession('failed\tExpected 3 but got 4\t15');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testAdd');
      expect(result).toEqual({
        className: 'MyTestCase',
        selector: 'testAdd',
        status: 'failed',
        message: 'Expected 3 but got 4',
        durationMs: 15,
      });
    });

    it('parses an error test result', () => {
      const session = createMockSession('error\tMessageNotUnderstood: #foo\t8');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testBad');
      expect(result).toEqual({
        className: 'MyTestCase',
        selector: 'testBad',
        status: 'error',
        message: 'MessageNotUnderstood: #foo',
        durationMs: 8,
      });
    });

    it('handles malformed response gracefully', () => {
      const session = createMockSession('');
      const result = sunit.runTestMethod(session, 'MyTestCase', 'testBad');
      expect(result.status).toBe('error');
      expect(result.durationMs).toBe(0);
    });
  });

  describe('runTestClass', () => {
    it('parses multiple test results', () => {
      const payload = [
        'MyTestCase\ttestAdd\tpassed\t',
        'MyTestCase\ttestRemove\tfailed\tAssert failed',
        'MyTestCase\ttestBad\terror\tMessageNotUnderstood',
      ].join('\n') + '\n';
      const session = createMockSession(payload);
      const results = sunit.runTestClass(session, 'MyTestCase');
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ className: 'MyTestCase', selector: 'testAdd', status: 'passed', message: '', durationMs: 0 });
      expect(results[1]).toEqual({ className: 'MyTestCase', selector: 'testRemove', status: 'failed', message: 'Assert failed', durationMs: 0 });
      expect(results[2]).toEqual({ className: 'MyTestCase', selector: 'testBad', status: 'error', message: 'MessageNotUnderstood', durationMs: 0 });
    });

    it('returns empty array when no results', () => {
      const session = createMockSession('');
      expect(sunit.runTestClass(session, 'MyTestCase')).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('throws SunitQueryError on GCI error', () => {
      const session = createMockSession('');
      (session.gci.GciTsExecuteFetchBytes as ReturnType<typeof vi.fn>).mockReturnValue({
        data: '',
        err: { ...noErr, number: 2101, message: 'TestCase not found' },
      });
      expect(() => sunit.discoverTestClasses(session)).toThrow('TestCase not found');
    });

    it('throws SunitQueryError when session is busy', () => {
      const session = createMockSession('');
      (session.gci.GciTsCallInProgress as ReturnType<typeof vi.fn>).mockReturnValue({ result: 1 });
      expect(() => sunit.discoverTestClasses(session)).toThrow('Session is busy');
    });
  });
});
