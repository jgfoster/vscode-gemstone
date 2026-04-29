import { ActiveSession } from './sessionManager';
import { executeFetchString, BrowserQueryError } from './browserQueries';
import { QueryExecutor } from './queries/types';

import { discoverTestClasses as sharedDiscoverTestClasses } from './queries/discoverTestClasses';
import { discoverTestMethods as sharedDiscoverTestMethods } from './queries/discoverTestMethods';
import { runTestMethod as sharedRunTestMethod } from './queries/runTestMethod';
import { runTestClass as sharedRunTestClass } from './queries/runTestClass';
import { runFailingTests as sharedRunFailingTests } from './queries/runFailingTests';
import { describeTestFailure as sharedDescribeTestFailure } from './queries/describeTestFailure';

// Re-export types from the shared layer.
export type { TestClassInfo } from './queries/discoverTestClasses';
export type { TestMethodInfo } from './queries/discoverTestMethods';
export type { TestRunResult } from './queries/runTestMethod';

// Backward compatibility alias — no callers catch this by class, but tests
// reference it in mocks.
export const SunitQueryError = BrowserQueryError;

function bind(session: ActiveSession): QueryExecutor {
  return (label, code) => executeFetchString(session, label, code);
}

export function discoverTestClasses(session: ActiveSession) {
  return sharedDiscoverTestClasses(bind(session));
}

export function discoverTestMethods(session: ActiveSession, className: string) {
  return sharedDiscoverTestMethods(bind(session), className);
}

export function runTestMethod(session: ActiveSession, className: string, selector: string) {
  return sharedRunTestMethod(bind(session), className, selector);
}

export function runTestClass(session: ActiveSession, className: string) {
  return sharedRunTestClass(bind(session), className);
}

export function runFailingTests(
  session: ActiveSession,
  classNames?: string[],
  classNamePattern?: string,
) {
  return sharedRunFailingTests(bind(session), classNames, classNamePattern);
}

export function describeTestFailure(session: ActiveSession, className: string, selector: string) {
  return sharedDescribeTestFailure(bind(session), className, selector);
}
