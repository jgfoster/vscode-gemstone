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
  // The encoding model GemStone wants us to use:
  //
  //   Unicode7 / Unicode16 / Unicode32 are *internal storage* formats with
  //   one codepoint per logical character (1 / 2 / 4 bytes per char).
  //   Unicode7 transparently widens to Unicode16 / Unicode32 when a wider
  //   codepoint is written.
  //
  //   Utf8 is the *transfer protocol* — variable-byte, compact for ASCII,
  //   but its bytes don't index by character, so `at:put:` and
  //   `copyFrom:to:` aren't defined.
  //
  // The pattern: build the full output internally with whichever Unicode
  // class fits, then call `asUtf8` once at the boundary to produce the
  // bytes GCI sends back. This avoids both prior bugs:
  //
  //   - Round 2 (`'Error: ' , e messageText asString` returning a Unicode16
  //     that GCI's Utf8 fetch passed through as raw UTF-16LE bytes) is fixed
  //     because `asUtf8` is now an explicit transcoding step.
  //   - Round 3 (`WriteStream on: Utf8 new` failing on buffer growth because
  //     Utf8 rejects `at:put:`) is fixed because the WriteStream is over an
  //     internal class that *is* extensible.
  //
  // The hint is a literal ASCII string, but we still pipe it through
  // `asUtf8` at the unified return below so every result has the same
  // transfer-protocol class.
  return `| dispatcher src result |
dispatcher := System myUserProfile symbolList objectNamed: #'ModuleAst'.
src := '${esc}'.
result := dispatcher isNil
  ifTrue: ['${GRAIL_HINT}']
  ifFalse: [
    [${grailExpression}]
      on: AbstractException do: [:e |
        | ws |
        ws := WriteStream on: String new.
        ws nextPutAll: 'Error: '.
        ws nextPutAll: e class name asString.
        ws nextPutAll: ' — '.
        ws nextPutAll: e messageText asString.
        ws contents]].
result asUtf8`;
}
