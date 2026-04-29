import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getDictionaryEntries } from '../getDictionaryEntries';
import { getGlobalsForDictionary } from '../getGlobalsForDictionary';
import { getAllClassNames } from '../getAllClassNames';
import { getClassEnvironments } from '../getClassEnvironments';
import { getClassHierarchy } from '../getClassHierarchy';
import { getMethodList } from '../getMethodList';
import { getStepPointSelectorRanges } from '../getStepPointSelectorRanges';
import { runFailingTests } from '../runFailingTests';
import { describeTestFailure } from '../describeTestFailure';
import { evalPython, compilePython } from '../python';

describe('getDictionaryEntries', () => {
  it('parses class (1) and global (0) rows', () => {
    const raw = '1\taccessing\tArray\n0\t\tMyVar\n';
    const results = getDictionaryEntries(vi.fn<QueryExecutor>(() => raw), 1);
    expect(results).toEqual([
      { isClass: true, category: 'accessing', name: 'Array' },
      { isClass: false, category: '', name: 'MyVar' },
    ]);
  });

  it('skips entries whose name is empty', () => {
    const raw = '1\taccessing\t\n1\taccessing\tFoo\n';
    const results = getDictionaryEntries(vi.fn<QueryExecutor>(() => raw), 1);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Foo');
  });
});

describe('getGlobalsForDictionary', () => {
  it('preserves tabs inside the value field', () => {
    const raw = 'X\tArray\tvalue\twith\ttabs\n';
    const results = getGlobalsForDictionary(vi.fn<QueryExecutor>(() => raw), 1);
    expect(results[0].value).toBe('value\twith\ttabs');
  });

  it('skips lines without at least two tabs', () => {
    const raw = 'bogus\noneTab\tonly\nok\tArray\tvalue\n';
    const results = getGlobalsForDictionary(vi.fn<QueryExecutor>(() => raw), 1);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('ok');
  });
});

describe('getAllClassNames', () => {
  it('parses dictIndex/dictName/className rows', () => {
    const raw = '1\tGlobals\tArray\n2\tUserGlobals\tMyClass\n';
    const results = getAllClassNames(vi.fn<QueryExecutor>(() => raw));
    expect(results).toEqual([
      { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      { dictIndex: 2, dictName: 'UserGlobals', className: 'MyClass' },
    ]);
  });
});

describe('getClassEnvironments', () => {
  it('detects class side via " class" suffix on receiver name', () => {
    const raw = 'Array class\t0\tinstance creation\tnew\twith:\n'
              + 'Array\t0\taccessing\tsize\n';
    const results = getClassEnvironments(vi.fn<QueryExecutor>(() => raw), 1, 'Array', 0);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      isMeta: true, envId: 0, category: 'instance creation',
    });
    expect(results[0].selectors).toEqual(['new', 'with:']);
    expect(results[1].isMeta).toBe(false);
  });

  it('embeds dictIndex, escaped class name, and maxEnv', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassEnvironments(execute, 3, "Foo'Bar", 2);
    const code = execute.mock.calls[0][1];
    expect(code).toContain('symbolList at: 3');
    expect(code).toContain("#'Foo''Bar'");
    expect(code).toContain('envs := 2');
  });
});

describe('getClassHierarchy', () => {
  it('preserves superclass/self/subclass order from Smalltalk', () => {
    const raw = 'Globals\tObject\tsuperclass\nGlobals\tArray\tself\nGlobals\tFoo\tsubclass\n';
    const results = getClassHierarchy(vi.fn<QueryExecutor>(() => raw), 'Array');
    expect(results.map(r => r.kind)).toEqual(['superclass', 'self', 'subclass']);
  });
});

describe('getMethodList', () => {
  it('parses instance (0) and class (1) rows', () => {
    const raw = '0\taccessing\tsize\n1\tinstance creation\tnew\n';
    const results = getMethodList(vi.fn<QueryExecutor>(() => raw), 'Array');
    expect(results).toEqual([
      { isMeta: false, category: 'accessing', selector: 'size' },
      { isMeta: true, category: 'instance creation', selector: 'new' },
    ]);
  });

  it('skips lines with fewer than 3 tab-separated fields', () => {
    const results = getMethodList(vi.fn<QueryExecutor>(() => 'incomplete\tonly\n0\tcat\tsel\n'), 'Array');
    expect(results).toHaveLength(1);
  });
});

describe('getStepPointSelectorRanges', () => {
  it('parses step point info with 0-based selectorOffset', () => {
    const raw = '1\t0\t3\tfoo\n2\t5\t4\tbar:\n';
    const results = getStepPointSelectorRanges(vi.fn<QueryExecutor>(() => raw), 'X', false, 'y');
    expect(results).toEqual([
      { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 5, selectorLength: 4, selectorText: 'bar:' },
    ]);
  });
});

describe('runFailingTests', () => {
  it('parses class\\tselector\\tstatus\\tmessage rows into TestRunResult[]', () => {
    const raw = 'MyTest\ttestBad\tfailed\texpected 1 got 2\nOther\ttestBoom\terror\tdivision by zero\n';
    const results = runFailingTests(vi.fn<QueryExecutor>(() => raw));
    expect(results).toEqual([
      { className: 'MyTest', selector: 'testBad', status: 'failed', message: 'expected 1 got 2', durationMs: 0 },
      { className: 'Other', selector: 'testBoom', status: 'error', message: 'division by zero', durationMs: 0 },
    ]);
  });

  // No classNames → discover-all path. The Smalltalk snippet must walk the
  // user's symbolList for TestCase subclasses (excluding TestCase itself);
  // the explicit-list-only `objectNamed:` and `reject:` constructs must NOT
  // appear, otherwise the path got swapped.
  it('uses the discover-all path when no classNames are given', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][1];
    expect(code).toContain('symbolList');
    expect(code).toContain('isSubclassOf: TestCase');
    expect(code).toContain('IdentitySet');
    expect(code).not.toContain('objectNamed:');
    expect(code).not.toContain('reject: [:c | c isNil]');
  });

  // With names → explicit-list path. Each name is resolved separately so a
  // single typo doesn't blow up the whole run; missing names get filtered
  // out before the suite executes.
  it('uses the explicit-list path when classNames are given, building the list at runtime', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, ['ArrayTest', 'StringTest']);
    const code = exec.mock.calls[0][1];
    expect(code).toContain("objectNamed: #'ArrayTest'");
    expect(code).toContain("objectNamed: #'StringTest'");
    expect(code).toContain('reject: [:c | c isNil]');
  });

  it('escapes single quotes in classNames', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, ["it's"]);
    const code = exec.mock.calls[0][1];
    expect(code).toContain("#'it''s'");
  });

  it('returns [] when nothing failed', () => {
    expect(runFailingTests(vi.fn<QueryExecutor>(() => ''))).toEqual([]);
  });

  // Bug guard: probe of GemStone's SUnit revealed that `result failures` and
  // `result errors` contain the TestCase instances themselves (only
  // `testSelector` ivar) — they don't respond to `#testCase`. Sending it
  // would silently DNU on real failures. The query must use direct
  // accessors (`each class name` / `each selector`), same as the passed
  // branch already does.
  it('does not send #testCase to failure/error wrappers', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][1];
    expect(code).not.toMatch(/testCase\s+class\s+name/);
    expect(code).not.toMatch(/testCase\s+selector/);
  });

  // Per-message cap: 1024 chars in the batched runner so a worst case of
  // ~250 failing tests still fits under the 256KB MAX_RESULT. The cap now
  // applies to the captured `<exceptionClass>: <messageText>` string from
  // the per-failure re-run (round-2 messageText capture) rather than the
  // old SUnit-debug-recipe printString. Lock the constant in.
  it('caps each captured message at 1024 chars to stay under MAX_RESULT', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][1];
    expect(code).toContain('s size min: 1024');
  });

  // Round-2 fix: the no-args path (DISCOVER_ALL) had `| sl seen list |` temp
  // declarations substituted into `classes := <expr>`, which is a Smalltalk
  // syntax error. The block wrap closes around the temps so the expression
  // is a valid value-producing form.
  it('wraps DISCOVER_ALL in a block so its temps do not collide with the outer assignment', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][1];
    expect(code).toMatch(/classes := \[\| sl seen list \|/);
    expect(code).toContain('] value');
  });

  // Round-2 enhancement: the message column should carry exception class
  // + actual messageText (captured by re-running each failing test with
  // its own AbstractException handler), not the SUnit debug recipe.
  it('captures exception class and messageText per failing test via re-run', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][1];
    expect(code).toContain('on: AbstractException');
    expect(code).toContain('t setUp');
    expect(code).toContain('t perform: t selector');
    expect(code).toContain('t tearDown');
    expect(code).toContain('captured class name');
    expect(code).toContain('captured messageText');
  });

  // Round-3 fix: the round-2 build used `WriteStream on: Utf8 new` to
  // force UTF-8 output, but Utf8 in this GemStone is invariant — buffer
  // growth requires at:put:, which Utf8 rejects. Fall back to a Unicode7
  // stream (proven extensible) plus per-character codepoint-128 gating so
  // non-ASCII content from Unicode16 messageText is replaced with `?`
  // rather than widening the buffer back to the original UTF-16 leak.
  it('writes output through a Unicode7 stream with per-char ASCII gating', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec);
    const code = exec.mock.calls[0][1];
    expect(code).toContain('WriteStream on: Unicode7 new');
    expect(code).not.toContain('WriteStream on: Utf8 new');
    // Per-char gate: anything ≥ 128 becomes `?`. The exact gate text is the
    // load-bearing assertion — round-2 lost this and reintroduced the
    // UTF-16 widening; round-3-immutable-Utf8 bug came from over-correcting.
    expect(code).toContain('asInteger < 128');
    expect(code).toContain("ifTrue: [ch] ifFalse: [$?]");
  });

  // classNamePattern path: expand globs server-side via GemStone's
  // `String match:` so a single round-trip handles the discover+filter+run.
  it('uses pattern-filter path when classNamePattern is given', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, undefined, 'Bytes*TestCase');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('isSubclassOf: TestCase');
    expect(code).toContain("pattern := 'Bytes*TestCase'");
    expect(code).toContain('pattern match: v name');
  });

  it('explicit classNames wins over classNamePattern (precedence)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    runFailingTests(exec, ['ArrayTest'], 'Bytes*TestCase');
    const code = exec.mock.calls[0][1];
    // classNames path runs (no pattern matching in the snippet).
    expect(code).toContain("objectNamed: #'ArrayTest'");
    expect(code).not.toContain('pattern match:');
  });
});

describe('describeTestFailure', () => {
  // The parser is line-prefixed key/value — unknown keys must be silently
  // ignored so a future Smalltalk-side addition (extra fields, GS-version
  // specific extras) doesn't crash callers.
  it('parses TestFailure-shaped output into structured details', () => {
    const raw = 'status: failed\n' +
      'exceptionClass: TestFailure\n' +
      'errorNumber: 2751\n' +
      'messageText: Assertion failed\n' +
      'description: TestFailure: Assertion failed\n';
    const result = describeTestFailure(vi.fn<QueryExecutor>(() => raw), 'ArrayTest', 'testBad');
    expect(result).toEqual({
      status: 'failed',
      exceptionClass: 'TestFailure',
      errorNumber: 2751,
      messageText: 'Assertion failed',
      description: 'TestFailure: Assertion failed',
    });
  });

  it('parses MessageNotUnderstood output, including mnuReceiver and mnuSelector', () => {
    const raw = 'status: error\n' +
      'exceptionClass: MessageNotUnderstood\n' +
      'errorNumber: 2010\n' +
      'messageText: a Object class does not understand #foo\n' +
      'description: a Object class does not understand #foo\n' +
      'mnuReceiver: Object\n' +
      'mnuSelector: foo\n';
    const result = describeTestFailure(vi.fn<QueryExecutor>(() => raw), 'ArrayTest', 'testErrors');
    expect(result.status).toBe('error');
    expect(result.exceptionClass).toBe('MessageNotUnderstood');
    expect(result.mnuReceiver).toBe('Object');
    expect(result.mnuSelector).toBe('foo');
  });

  it('parses passed status with no other fields', () => {
    const result = describeTestFailure(vi.fn<QueryExecutor>(() => 'status: passed\n'), 'X', 'y');
    expect(result.status).toBe('passed');
    expect(result.exceptionClass).toBeUndefined();
    expect(result.messageText).toBeUndefined();
  });

  // Unknown keys must not throw — required so we can extend the snippet
  // server-side without coordinating client updates.
  it('ignores unknown keys', () => {
    const raw = 'status: failed\nfutureField: whatever\nexceptionClass: TestFailure\n';
    const result = describeTestFailure(vi.fn<QueryExecutor>(() => raw), 'X', 'y');
    expect(result.status).toBe('failed');
    expect(result.exceptionClass).toBe('TestFailure');
  });

  // The Smalltalk side has to use AbstractException — the GS hierarchy
  // means MessageNotUnderstood escapes past Exception in some session
  // contexts. Lock this in so a future "simplification" doesn't regress.
  it('uses AbstractException for the live exception capture', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'ArrayTest', 'testGood');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('on: AbstractException');
    expect(code).not.toMatch(/on: Exception\b/);
  });

  // Bypass SUnit's swallow-the-exception runner.
  it('runs setUp / perform / tearDown manually rather than going through TestCase>>run', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'ArrayTest', 'testGood');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('tc setUp');
    expect(code).toContain('tc perform:');
    expect(code).toContain('tc tearDown');
    expect(code).not.toMatch(/tc run\b/);
  });

  it('escapes single quotes in className and selector', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, "Foo'Bar", "test'X");
    const code = exec.mock.calls[0][1];
    expect(code).toContain("Foo''Bar");
    expect(code).toContain("test''X");
  });

  // Stack capture path: the gem-level config GemExceptionSignalCapturesStack
  // controls whether AbstractException's gsStack is populated at signal time.
  // Without toggling it on, stackReport returns nil even on a live exception.
  it('toggles GemExceptionSignalCapturesStack around the run and restores after', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'ArrayTest', 'testGood');
    const code = exec.mock.calls[0][1];

    // Saved before, set true during, restored in ensure: after.
    expect(code).toContain('System gemConfigurationAt: #GemExceptionSignalCapturesStack');
    expect(code).toContain("gemConfigurationAt: #GemExceptionSignalCapturesStack put: true");
    expect(code).toContain("gemConfigurationAt: #GemExceptionSignalCapturesStack put: oldStackCfg");
    expect(code).toContain('ensure:');
  });

  // The sentinel keeps multi-line stack content separate from the
  // line-prefixed key/value section. Without it, frame newlines would split
  // into bogus key/value pairs and the parser would lose the stack.
  it('parses stackReport that follows the sentinel as one verbatim block', () => {
    const raw = 'status: failed\n' +
      'exceptionClass: TestFailure\n' +
      'errorNumber: 2751\n' +
      'messageText: Assertion failed\n' +
      'description: TestFailure: Assertion failed\n' +
      '--- stackReport ---\n' +
      'TestFailure (AbstractException) >> signal: @3 line 7  [GsNMethod 3523841]\n' +
      'TestFailure class (AbstractException class) >> signal: @3 line 4  [GsNMethod 3803137]\n' +
      'JasperProbeTest >> testFails @3 line 1  [GsNMethod 1236251649]\n';
    const result = describeTestFailure(vi.fn<QueryExecutor>(() => raw), 'X', 'y');
    expect(result.status).toBe('failed');
    expect(result.exceptionClass).toBe('TestFailure');
    expect(result.stackReport).toContain('TestFailure (AbstractException) >> signal:');
    expect(result.stackReport).toContain('JasperProbeTest >> testFails');
    // Frame separator newlines must survive intact.
    expect((result.stackReport || '').split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('omits stackReport when the sentinel is absent (e.g. config rejected)', () => {
    const raw = 'status: failed\nexceptionClass: TestFailure\nmessageText: Assertion failed\n';
    const result = describeTestFailure(vi.fn<QueryExecutor>(() => raw), 'X', 'y');
    expect(result.stackReport).toBeUndefined();
  });

  // Stack cap: 16384 chars in the Smalltalk side keeps the largest
  // realistic trace under MAX_RESULT (256KB) while leaving plenty of
  // room for the scalar fields. Lock it in so a future bump doesn't
  // accidentally produce truncated output that's hard to diagnose.
  it('caps stackReport at 16384 chars', () => {
    const exec = vi.fn<QueryExecutor>(() => 'status: passed\n');
    describeTestFailure(exec, 'X', 'y');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('size min: 16384');
  });
});

describe('python (Grail) queries', () => {
  // Detection: a missing ModuleAst class is the signal that Grail isn't
  // installed. Direct reference like `ModuleAst evaluateSource: ...` would
  // be a *compile-time* failure of our query source — there'd be no
  // runtime exception to catch. Resolving via objectNamed: makes the
  // dispatcher's absence a runtime nil check we can branch on.
  it('uses objectNamed: ModuleAst rather than a direct class reference', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][1];
    expect(code).toContain("objectNamed: #'ModuleAst'");
    expect(code).toContain('dispatcher isNil');
  });

  it('emits a graceful "Grail not detected" hint as the nil-branch result', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('Grail (GemStone-Python) not detected');
    expect(code).toContain('class ModuleAst not found');
  });

  // The dispatcher is reused across both tools — they should produce
  // identical detection scaffolding, only differing in the Grail
  // expression that runs in the ifFalse branch.
  it('eval_python uses ModuleAst evaluateSource: (returns the printed result)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'print(1+2)');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('dispatcher evaluateSource: src');
    expect(code).toContain('printString');
  });

  it('compile_python uses (ModuleAst parseSource: src) smalltalkSource', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    compilePython(exec, 'x = 1');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('dispatcher parseSource: src');
    expect(code).toContain('smalltalkSource');
  });

  // Python source frequently contains single-quoted string literals — the
  // standard Smalltalk doubling rule must apply or the query won't parse.
  it('escapes single quotes in Python source', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, "x = 'hello'");
    const code = exec.mock.calls[0][1];
    expect(code).toContain("''hello''");
  });

  // Errors from Grail's compile/runtime path (SyntaxError, NameError, etc.)
  // are caught and reported inline as "Error: <class> — <messageText>" so
  // the agent gets a usable diagnostic, not a dropped tool call.
  it('wraps the Grail call in on: AbstractException do:', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][1];
    expect(code).toContain('on: AbstractException');
    // Round-3 build: error string flows through a Unicode7 stream with
    // per-char ASCII gating. See the regression guards below for why each
    // alternative (Utf8 buffer, plain Unicode7, `,` concatenation) is wrong.
    expect(code).toContain('WriteStream on: Unicode7 new');
    expect(code).toContain("'Error: '");
    expect(code).toContain('asInteger < 128');
    expect(code).toContain("ifTrue: [ch] ifFalse: [$?]");
  });

  // Round-2 regression guard: the eval_python error path was previously built
  // via `, ` concatenation, which widened the result to Unicode16 when
  // messageText was Unicode16 — GCI's Utf8 fetch then forwarded UTF-16LE
  // bytes raw and the agent saw `"E r r o r :   M ..."`.
  it('does not build the error string via , concatenation (UTF-16 leak guard)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][1];
    expect(code).not.toMatch(/'Error: ' , e class name/);
  });

  // Round-3 regression guard: the round-2 fix `WriteStream on: Utf8 new`
  // forced UTF-8 output, but Utf8 in this GemStone is invariant —
  // growing the buffer triggers at:put: which Utf8 rejects with
  // rtErrShouldNotImplement. Every error case failed with
  // "Receiver: anUtf8(). Selector: #'at:put:'". The Unicode7 stream
  // assertion above is the positive test; this is the negative one.
  it('does not write through a Utf8 stream (Utf8 immutability guard)', () => {
    const exec = vi.fn<QueryExecutor>(() => '');
    evalPython(exec, 'x = 1');
    const code = exec.mock.calls[0][1];
    expect(code).not.toContain('WriteStream on: Utf8 new');
  });

  it('returns the executor result verbatim — no parsing on the JS side', () => {
    const result = evalPython(vi.fn<QueryExecutor>(() => '3'), '1 + 2');
    expect(result).toBe('3');
  });
});
