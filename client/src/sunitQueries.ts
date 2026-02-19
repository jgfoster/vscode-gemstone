import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL } from './gciConstants';
import { logQuery, logResult, logError, logGciCall, logGciResult } from './gciLog';

const MAX_RESULT = 256 * 1024;

// Cache resolved OOP_CLASS_Utf8 per session handle
const classUtf8Cache = new Map<unknown, bigint>();

export class SunitQueryError extends Error {
  constructor(message: string, public readonly gciErrorNumber: number = 0) {
    super(message);
  }
}

function resolveClassUtf8(session: ActiveSession): bigint {
  let oop = classUtf8Cache.get(session.handle);
  if (oop !== undefined) return oop;
  const { result, err } = session.gci.GciTsResolveSymbol(session.handle, 'Utf8', OOP_NIL);
  if (err.number !== 0) {
    throw new SunitQueryError(
      err.message || 'Cannot resolve Utf8 class', err.number
    );
  }
  oop = result;
  classUtf8Cache.set(session.handle, oop);
  return oop;
}

function executeFetchString(session: ActiveSession, label: string, code: string): string {
  logQuery(session.id, label, code);

  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new SunitQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  logGciCall(session.id, 'GciTsExecuteFetchBytes', {
    sourceStr: code,
    sourceSize: -1,
    sourceOop: oopClassUtf8,
    contextObject: OOP_ILLEGAL,
    symbolList: OOP_NIL,
    maxResultSize: MAX_RESULT,
  });

  const { bytesReturned, data, err } = session.gci.GciTsExecuteFetchBytes(
    session.handle,
    code,
    -1,
    oopClassUtf8,
    OOP_ILLEGAL,
    OOP_NIL,
    MAX_RESULT,
  );

  logGciResult(session.id, 'GciTsExecuteFetchBytes', {
    bytesReturned,
    data,
    'err.number': err.number,
    'err.category': err.category,
    'err.context': err.context,
    'err.exceptionObj': err.exceptionObj,
    'err.args': err.args,
    'err.message': err.message,
    'err.reason': err.reason,
    'err.fatal': err.fatal,
  });

  if (err.number !== 0) {
    const msg = err.message || `GCI error ${err.number}`;
    logError(session.id, msg);
    throw new SunitQueryError(msg, err.number);
  }
  logResult(session.id, data);
  return data;
}

function splitLines(result: string): string[] {
  return result.split('\n').filter(s => s.length > 0);
}

function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

// ── Types ──────────────────────────────────────────────────

export interface TestClassInfo {
  dictName: string;
  className: string;
}

export interface TestMethodInfo {
  selector: string;
  category: string;
}

export interface TestRunResult {
  className: string;
  selector: string;
  status: 'passed' | 'failed' | 'error';
  message: string;
  durationMs: number;
}

// ── Discovery ──────────────────────────────────────────────

/**
 * Find all TestCase subclasses visible in the user's symbol list.
 * Returns dictName + className pairs.
 */
export function discoverTestClasses(session: ActiveSession): TestClassInfo[] {
  const code = `| ws sl classDict |
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(classDict includesKey: v) not]]])
        ifTrue: [classDict at: v put: dict name]]].
ws := WriteStream on: Unicode7 new.
classDict keysAndValuesDo: [:cls :dictName |
  ws nextPutAll: dictName; tab; nextPutAll: cls name; lf].
ws contents`;
  const data = executeFetchString(session, 'discoverTestClasses', code);
  return splitLines(data).map(line => {
    const [dictName, className] = line.split('\t');
    return { dictName, className };
  });
}

/**
 * Get test method selectors and their categories for a TestCase subclass.
 */
export function discoverTestMethods(session: ActiveSession, className: string): TestMethodInfo[] {
  const code = `| ws |
ws := WriteStream on: Unicode7 new.
${escapeString(className)} testSelectors asSortedCollection do: [:each |
  ws nextPutAll: each;
    tab;
    nextPutAll: ((${escapeString(className)} categoryOfSelector: each environmentId: 0) ifNil: ['']);
    lf].
ws contents`;
  const data = executeFetchString(session, 'discoverTestMethods', code);
  return splitLines(data).map(line => {
    const [selector, category] = line.split('\t');
    return { selector, category: category || '' };
  });
}

// ── Execution ──────────────────────────────────────────────

/**
 * Run a single test method and return the result.
 * Result format from Smalltalk: status\tmessage\tdurationMs
 */
export function runTestMethod(session: ActiveSession, className: string, selector: string): TestRunResult {
  const code = `| testCase result ws startMs endMs |
startMs := Time millisecondClockValue.
testCase := ${escapeString(className)} selector: #'${escapeString(selector)}'.
result := testCase run.
endMs := Time millisecondClockValue.
ws := WriteStream on: Unicode7 new.
(result hasPassed)
  ifTrue: [ws nextPutAll: 'passed'; tab; tab]
  ifFalse: [
    result failures size > 0
      ifTrue: [
        | failure |
        failure := result failures asArray first.
        ws nextPutAll: 'failed'; tab;
          nextPutAll: (failure printString copyFrom: 1 to: (failure printString size min: 4096)); tab]
      ifFalse: [
        | err |
        err := result errors asArray first.
        ws nextPutAll: 'error'; tab;
          nextPutAll: (err printString copyFrom: 1 to: (err printString size min: 4096)); tab]].
ws nextPutAll: (endMs - startMs) printString.
ws contents`;
  const data = executeFetchString(session, 'runTestMethod', code);
  const parts = data.split('\t');
  return {
    className,
    selector,
    status: (parts[0] || 'error') as TestRunResult['status'],
    message: parts[1] || '',
    durationMs: parseInt(parts[2] || '0', 10) || 0,
  };
}

/**
 * Run all tests in a class and return per-method results.
 * Result format from Smalltalk: className\tselector\tstatus\tmessage per line.
 */
export function runTestClass(session: ActiveSession, className: string): TestRunResult[] {
  const code = `| suite result ws |
suite := ${escapeString(className)} suite.
result := suite run.
ws := WriteStream on: Unicode7 new.
result passed do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'passed'; tab; lf].
result failures do: [:each |
  ws nextPutAll: each testCase class name; tab;
    nextPutAll: each testCase selector; tab;
    nextPutAll: 'failed'; tab;
    nextPutAll: (each printString copyFrom: 1 to: (each printString size min: 4096)); lf].
result errors do: [:each |
  ws nextPutAll: each testCase class name; tab;
    nextPutAll: each testCase selector; tab;
    nextPutAll: 'error'; tab;
    nextPutAll: (each printString copyFrom: 1 to: (each printString size min: 4096)); lf].
ws contents`;
  const data = executeFetchString(session, 'runTestClass', code);
  return splitLines(data).map(line => {
    const parts = line.split('\t');
    return {
      className: parts[0] || className,
      selector: parts[1] || '',
      status: (parts[2] || 'error') as TestRunResult['status'],
      message: parts[3] || '',
      durationMs: 0,
    };
  });
}
