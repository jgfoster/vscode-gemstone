import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';
import { TestRunResult } from './runTestMethod';

// Per-message printString cap. Single-method runs use 4096 because there's
// only one entry; batched runs across many TestCases need a tighter cap to
// stay under MAX_RESULT (256KB) when many tests fail at once. 1024 chars
// per entry leaves headroom for ~250 failures in a single round trip.
const MAX_MSG = 1024;

// Run SUnit suites and return only the failed/errored results — the agent
// equivalent of `run_tests.sh | grep -A20 'Test failures:'`.
//
// Class selection precedence: explicit `classNames` wins; otherwise a
// `classNamePattern` (GemStone glob, `*` matches any chars) filters the
// discovered TestCase subclasses; otherwise every TestCase subclass in the
// user's symbolList is run. With explicit classNames, missing names are
// skipped silently rather than aborting the run.
//
// Single round-trip by design: iteration happens in Smalltalk so an N-class
// invocation is one GCI call, not N.
export function runFailingTests(
  execute: QueryExecutor,
  classNames?: string[],
  classNamePattern?: string,
): TestRunResult[] {
  let classesExpr: string;
  if (classNames && classNames.length > 0) {
    classesExpr = buildExplicitClassList(classNames);
  } else if (classNamePattern) {
    classesExpr = buildPatternFilter(classNamePattern);
  } else {
    classesExpr = DISCOVER_ALL_TEST_CLASSES;
  }

  // `result failures` and `result errors` contain the TestCase instances
  // themselves (only `testSelector` ivar) — verified via probe. Don't send
  // `t testCase`: the wrappers don't respond to it, and a real failure
  // would DNU. Use `t class name` / `t selector` directly.
  //
  // Round-2 enhancement: re-run each failing/erroring test with our own
  // AbstractException handler to capture the real messageText. Without this
  // the message column is just `t printString` — the SUnit debug recipe
  // ("ClassTestCase debug: #testFooBar"), which says *which* test failed
  // but nothing about *why*. Re-running doubles the cost for failing tests
  // only; a project where most tests pass barely notices. Iteration stays
  // in Smalltalk so it remains one GCI round-trip.
  //
  // Round-3 fix: build the captured message via a Unicode7 stream with
  // per-char ASCII gating, not via `, ` concatenation against a Utf8
  // buffer. See python.ts for the full rationale — `, ` widens to
  // Unicode16 (which GCI's Utf8 fetch forwards as raw UTF-16LE bytes) and
  // `WriteStream on: Utf8 new` rejects the at:put: that buffer growth
  // requires. Unicode7 + codepoint-128 gating dodges both.
  const code = `| ws classes captureMessage |
classes := ${classesExpr}.
captureMessage := [:t |
  | captured |
  captured := nil.
  [t setUp.
   t perform: t selector.
   t tearDown] on: AbstractException do: [:e | captured := e].
  captured isNil
    ifTrue: ['(no exception on re-run)']
    ifFalse: [
      | inner coerce s |
      inner := WriteStream on: Unicode7 new.
      coerce := [:str | str asString do: [:ch |
        inner nextPut: (ch asInteger < 128 ifTrue: [ch] ifFalse: [$?])]].
      coerce value: captured class name.
      inner nextPutAll: ': '.
      coerce value: captured messageText.
      s := inner contents.
      s copyFrom: 1 to: (s size min: ${MAX_MSG})]].
ws := WriteStream on: Unicode7 new.
classes do: [:cls |
  | result |
  result := cls suite run.
  result failures do: [:t |
    ws nextPutAll: t class name; tab;
      nextPutAll: t selector; tab;
      nextPutAll: 'failed'; tab;
      nextPutAll: (captureMessage value: t); lf].
  result errors do: [:e |
    ws nextPutAll: e class name; tab;
      nextPutAll: e selector; tab;
      nextPutAll: 'error'; tab;
      nextPutAll: (captureMessage value: e); lf]].
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
//
// The fragment is wrapped as `[| ... | ...] value` because it gets substituted
// into `classes := <expr>` — Smalltalk does not allow temp declarations in
// expression position. Without the wrap, the no-args call path produced a
// CompileError "expected a primary expression" before any test could run.
const DISCOVER_ALL_TEST_CLASSES = `[| sl seen list |
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
list] value`;

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

// Pattern path: same symbolList walk as DISCOVER_ALL_TEST_CLASSES, but
// gated on `pattern match: v name`. Uses GemStone's standard glob:
// `*` matches any sequence of characters, `#` matches a single character.
// E.g. `Bytes*TestCase` picks up BytesTestCase, BytesIntTestCase, etc.
function buildPatternFilter(pattern: string): string {
  const esc = escapeString(pattern);
  return `[| sl seen list pattern |
sl := System myUserProfile symbolList.
seen := IdentitySet new.
list := OrderedCollection new.
pattern := '${esc}'.
sl do: [:dict |
  dict valuesDo: [:v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(seen includes: v) not
      and: [pattern match: v name]]]])
        ifTrue: [seen add: v. list add: v]]].
list] value`;
}
