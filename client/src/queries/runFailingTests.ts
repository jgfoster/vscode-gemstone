import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';
import { TestRunResult } from './runTestMethod';

// Per-message printString cap. Single-method runs use 4096 because there's
// only one entry; batched runs across many TestCases need a tighter cap to
// stay under MAX_RESULT (256KB) when many tests fail at once. 1024 chars
// per entry leaves headroom for ~250 failures in a single round trip.
const MAX_MSG = 1024;

// Run SUnit suites and return only the failed/errored results — the agent
// equivalent of `run_tests.sh | grep -A20 'Test failures:'`. With no
// classNames, discovers and runs every TestCase subclass in the user's
// symbolList. With explicit classNames, resolves each via objectNamed:; a
// name that doesn't resolve is skipped silently rather than aborting the run.
//
// Single round-trip by design: iteration happens in Smalltalk so an N-class
// invocation is one GCI call, not N.
export function runFailingTests(
  execute: QueryExecutor,
  classNames?: string[],
): TestRunResult[] {
  const classesExpr = classNames && classNames.length > 0
    ? buildExplicitClassList(classNames)
    : DISCOVER_ALL_TEST_CLASSES;

  const code = `| ws classes |
classes := ${classesExpr}.
ws := WriteStream on: Unicode7 new.
classes do: [:cls |
  | result |
  result := cls suite run.
  result failures do: [:t |
    ws nextPutAll: t testCase class name; tab;
      nextPutAll: t testCase selector; tab;
      nextPutAll: 'failed'; tab;
      nextPutAll: (t printString copyFrom: 1 to: (t printString size min: ${MAX_MSG})); lf].
  result errors do: [:e |
    ws nextPutAll: e testCase class name; tab;
      nextPutAll: e testCase selector; tab;
      nextPutAll: 'error'; tab;
      nextPutAll: (e printString copyFrom: 1 to: (e printString size min: ${MAX_MSG})); lf]].
ws contents`;
  const data = execute('runFailingTests', code);
  return splitLines(data).map(line => {
    const parts = line.split('\t');
    return {
      className: parts[0] || '',
      selector: parts[1] || '',
      status: (parts[2] || 'error') as TestRunResult['status'],
      message: parts[3] || '',
      durationMs: 0,
    };
  });
}

// Walk the user's symbolList for every TestCase subclass (excluding TestCase
// itself), deduped via IdentitySet so a class registered in two dicts is run
// only once.
const DISCOVER_ALL_TEST_CLASSES = `| sl seen list |
sl := System myUserProfile symbolList.
seen := IdentitySet new.
list := OrderedCollection new.
sl do: [:dict |
  dict valuesDo: [:v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(seen includes: v) not]]])
        ifTrue: [seen add: v. list add: v]]].
list`;

// Explicit-list path: build an OrderedCollection at runtime, doing each
// lookup separately so a typo doesn't blow up the whole run. Anything that
// resolves to nil (missing class) is filtered out before the suite runs.
function buildExplicitClassList(classNames: string[]): string {
  const adds = classNames
    .map(n => `add: (System myUserProfile symbolList objectNamed: #'${escapeString(n)}');`)
    .join('\n  ');
  return `((OrderedCollection new
  ${adds}
  yourself) reject: [:c | c isNil])`;
}
