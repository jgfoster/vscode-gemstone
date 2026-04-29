import { QueryExecutor } from './types';
import { escapeString } from './util';

// Grail (GemStone-Python) integration. Both queries are graceful when Grail
// isn't installed: the dispatcher class lookup returns nil and we emit a
// hint instead of letting the Smalltalk source fail to compile against an
// undefined `ModuleAst` reference.
//
// Why dynamic resolution (not a direct `ModuleAst evaluateSource:` send):
// referring to ModuleAst in the source string is a *compile-time* reference.
// When Grail isn't loaded, that source doesn't parse — there's no runtime
// exception to catch with `on: AbstractException do:`. Resolving via
// `objectNamed:` makes the dispatcher's absence a runtime nil check.

const GRAIL_HINT =
  'Grail (GemStone-Python) not detected: class ModuleAst not found in symbolList. ' +
  'Install Grail or activate it in this session before using the python tools.';

// Run a Python source string through Grail's compile + execute pipeline and
// return the result as a printString. Any Grail-side compile or runtime
// exception (SyntaxError, NameError, division-by-zero, etc.) is reported
// inline as `Error: <class> — <messageText>` so the agent can act on it.
export function evalPython(execute: QueryExecutor, source: string): string {
  const code = buildPythonQuery('(dispatcher evaluateSource: src) printString', source);
  return execute('evalPython', code);
}

// Transpile a Python source string to Smalltalk via Grail and return the
// generated Smalltalk source verbatim. Useful for inspecting codegen output
// without actually running the code (and as an end-to-end check on the
// codegen pipeline). Errors are reported inline, same shape as evalPython.
export function compilePython(execute: QueryExecutor, source: string): string {
  const code = buildPythonQuery('(dispatcher parseSource: src) smalltalkSource', source);
  return execute('compilePython', code);
}

function buildPythonQuery(grailExpression: string, pythonSource: string): string {
  const esc = escapeString(pythonSource);
  // The hint is itself a Smalltalk string literal — the same single-quote
  // escaping rule applies, but it has none today, so we inline it directly.
  //
  // Why the error path uses a Unicode7 buffer with per-char ASCII gating:
  // there are two GS-string traps to dodge.
  //
  // 1. A bare `'Error: ' , e messageText asString` concatenation widens the
  //    result to Unicode16 when messageText is Unicode16 (common for system
  //    errors like MessageNotUnderstood), and GCI's `Utf8`-class fetch
  //    forwards those UTF-16LE bytes raw — the round-2 agent saw
  //    "E r r o r :   M ..." (every char followed by a NUL).
  //
  // 2. The fix that landed in 1.4.2 — `WriteStream on: Utf8 new` — does
  //    force UTF-8 output, but Utf8 in this GemStone is invariant: growing
  //    the buffer requires `at:put:`, which Utf8 rejects with
  //    rtErrShouldNotImplement. Round-3 agent saw every error case fail
  //    with "Receiver: anUtf8(). Selector: #'at:put:'".
  //
  // Right answer: a Unicode7 stream (proven extensible — used elsewhere
  // in this file) plus codepoint-128 gating so non-ASCII characters never
  // reach it. The result is pure ASCII; GCI transcodes ASCII → UTF-8
  // trivially. We lose non-ASCII content from messageText (rare), but
  // error messages don't need to be lossless to be useful.
  return `| dispatcher src |
dispatcher := System myUserProfile symbolList objectNamed: #'ModuleAst'.
src := '${esc}'.
dispatcher isNil
  ifTrue: ['${GRAIL_HINT}']
  ifFalse: [
    [${grailExpression}]
      on: AbstractException do: [:e |
        | ws coerce |
        ws := WriteStream on: Unicode7 new.
        coerce := [:s | s asString do: [:ch |
          ws nextPut: (ch asInteger < 128 ifTrue: [ch] ifFalse: [$?])]].
        ws nextPutAll: 'Error: '.
        coerce value: e class name.
        ws nextPutAll: ' — '.
        coerce value: e messageText.
        ws contents]]`;
}
