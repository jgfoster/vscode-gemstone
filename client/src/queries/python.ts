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
  // Why the error path uses `WriteStream on: Utf8 new` instead of `,`
  // concatenation: GemStone's Exception class returns `messageText` as
  // `Unicode16` for many system errors (notably MessageNotUnderstood). A
  // bare `'Error: ' , <U16>` widens the result to Unicode16, and GCI's
  // `Utf8`-class fetch forwards those UTF-16LE bytes raw — the agent saw
  // "E r r o r :   M ..." (every char followed by a NUL). Pinning the
  // underlying buffer to `Utf8` forces transcoding on write, so GCI sees
  // an already-Utf8 result and can hand it back without further work.
  return `| dispatcher src |
dispatcher := System myUserProfile symbolList objectNamed: #'ModuleAst'.
src := '${esc}'.
dispatcher isNil
  ifTrue: ['${GRAIL_HINT}']
  ifFalse: [
    [${grailExpression}]
      on: AbstractException do: [:e |
        | ws |
        ws := WriteStream on: Utf8 new.
        ws nextPutAll: 'Error: '.
        ws nextPutAll: e class name asString.
        ws nextPutAll: ' — '.
        ws nextPutAll: e messageText asString.
        ws contents]]`;
}
