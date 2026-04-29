// Smoke tests for the SUnit-family queries against a live stone.
//
// Covers `runTestMethod`, `runTestClass`, `runFailingTests`, and
// `describeTestFailure`. Every one of these tools went through at least one
// round of "the unit tests passed but the live tool didn't work" — the
// `each testCase` DNU bug, the Utf8 stream growth failure, the missing
// `asUtf8` selector. With a real session, the test that proves the tool
// works is "ask it about a known fixture and check the output."

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runTestMethod } from '../../queries/runTestMethod';
import { runTestClass } from '../../queries/runTestClass';
import { runFailingTests } from '../../queries/runFailingTests';
import { describeTestFailure } from '../../queries/describeTestFailure';
import { HarnessSession, login } from './queryHarness';
import {
  installProbeFixture, uninstallProbeFixture,
  PROBE_TEST_CLASS, PROBE_PASSING_SELECTOR, PROBE_FAILING_SELECTOR, PROBE_ERRORING_SELECTOR,
} from './probeFixture';

describe('SUnit queries (live GCI)', () => {
  let s: HarnessSession;

  beforeAll(() => {
    s = login();
    installProbeFixture(s.exec);
  });
  afterAll(() => {
    if (s) {
      try { uninstallProbeFixture(s.exec); } catch { /* keep going */ }
      s.logout();
    }
  });

  describe('runTestMethod', () => {
    // Round-1 (round-3-revisited) ask: the message column on a failing
    // test should carry the live exception text, not the SUnit debug
    // recipe. The probe's `testFails` does `self assert: 1 = 2`, so we
    // expect a TestFailure with an "Assertion failed"-style messageText.
    it('reports the live exception class and messageText for a failing test', () => {
      const result = runTestMethod(s.exec, PROBE_TEST_CLASS, PROBE_FAILING_SELECTOR);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('TestFailure');
      // The classic round-3 regression: every failing test came back as
      // "Receiver: anUtf8(). Selector: #'at:put:'". Pin its absence.
      expect(result.message).not.toContain("Selector:  #'at:put:'");
      expect(result.message).not.toContain('\0');
    });

    it('reports MessageNotUnderstood with the bad selector for an erroring test', () => {
      const result = runTestMethod(s.exec, PROBE_TEST_CLASS, PROBE_ERRORING_SELECTOR);
      expect(result.status).toBe('error');
      expect(result.message).toContain('MessageNotUnderstood');
      expect(result.message).toContain('doesNotUnderstandWHATEVER');
      expect(result.message).not.toContain('\0');
    });

    it('reports a passing test with no message', () => {
      const result = runTestMethod(s.exec, PROBE_TEST_CLASS, PROBE_PASSING_SELECTOR);
      expect(result.status).toBe('passed');
      expect(result.message).toBe('');
    });
  });

  describe('runTestClass', () => {
    it('reports per-method results for the probe class', () => {
      const results = runTestClass(s.exec, PROBE_TEST_CLASS);
      const bySel = new Map(results.map(r => [r.selector, r]));

      expect(bySel.get(PROBE_PASSING_SELECTOR)?.status).toBe('passed');
      expect(bySel.get(PROBE_FAILING_SELECTOR)?.status).toBe('failed');
      expect(bySel.get(PROBE_ERRORING_SELECTOR)?.status).toBe('error');

      // The pre-fix output looked like `JasperProbeTest debug: #testFails`
      // (the SUnit debug recipe). The post-fix output carries
      // `TestFailure: ...`. Either way it must not be a wrapper error.
      const failing = bySel.get(PROBE_FAILING_SELECTOR)!;
      expect(failing.message).not.toContain("Selector:  #'at:put:'");
      expect(failing.message).not.toContain('\0');
    });
  });

  describe('runFailingTests', () => {
    // The classNames path bypasses the discover-all branch; the no-args
    // path tests it. Round-2 had a CompileError on the no-args path
    // because the discover-all fragment had un-wrapped temps.
    it('with explicit classNames returns only failed/errored entries', () => {
      const results = runFailingTests(s.exec, [PROBE_TEST_CLASS]);
      const sels = new Set(results.map(r => r.selector));
      expect(sels.has(PROBE_FAILING_SELECTOR)).toBe(true);
      expect(sels.has(PROBE_ERRORING_SELECTOR)).toBe(true);
      expect(sels.has(PROBE_PASSING_SELECTOR)).toBe(false);

      // None of the messages should be a Utf8 wrapper error or a NUL leak.
      for (const r of results) {
        expect(r.message).not.toContain("Selector:  #'at:put:'");
        expect(r.message).not.toContain("Selector:  #'copyFrom:to:'");
        expect(r.message).not.toContain('\0');
      }
    });

    it('with classNamePattern filters the discovered TestCase set', () => {
      const results = runFailingTests(s.exec, undefined, 'JasperProbe*');
      // Pattern matches our probe class. We expect both failures from it.
      const probeFailures = results.filter(r => r.className === PROBE_TEST_CLASS);
      expect(probeFailures.length).toBeGreaterThanOrEqual(2);
    });

    it('with no arguments runs without a CompileError (the round-2 regression)', () => {
      // We don't assert on full content because the suite is the entire
      // stone — could be huge and slow. The point of this test is to
      // confirm the discover-all Smalltalk fragment compiles. If the
      // round-2 "expected a primary expression" bug returns, the call
      // throws here.
      expect(() => runFailingTests(s.exec)).not.toThrow();
    });
  });

  describe('describeTestFailure', () => {
    it('returns structured fields for a TestFailure', () => {
      const details = describeTestFailure(s.exec, PROBE_TEST_CLASS, PROBE_FAILING_SELECTOR);
      expect(details.status).toBe('failed');
      expect(details.exceptionClass).toBe('TestFailure');
      expect(details.messageText).toBeDefined();
      expect(details.messageText).not.toContain('\0');
    });

    it('returns mnuReceiver and mnuSelector for a MessageNotUnderstood', () => {
      const details = describeTestFailure(s.exec, PROBE_TEST_CLASS, PROBE_ERRORING_SELECTOR);
      expect(details.status).toBe('error');
      expect(details.exceptionClass).toBe('MessageNotUnderstood');
      expect(details.mnuSelector).toBe('doesNotUnderstandWHATEVER');
      expect(details.mnuReceiver).toBeDefined();
    });

    // GemExceptionSignalCapturesStack is toggled inside the query and
    // restored. Stack capture is non-deterministic across GS versions, so
    // we only assert on shape: stackReport is either present and non-empty
    // or absent (the toggle wasn't honored on this stone).
    it('includes a stackReport when the gem-config toggle is honored', () => {
      const details = describeTestFailure(s.exec, PROBE_TEST_CLASS, PROBE_FAILING_SELECTOR);
      if (details.stackReport !== undefined) {
        expect(details.stackReport.length).toBeGreaterThan(0);
        expect(details.stackReport).not.toContain('\0');
      }
    });
  });
});
