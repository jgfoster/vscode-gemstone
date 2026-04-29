# `gemstone` MCP Server — Agent Feedback

Notes from a Claude Code session that implemented the class-call fast
path (`bool(x)`, `int(x)`, `object()`, etc.) for `CallAst`. The session
used the standard CLI workflow (`./install.sh`, `./scripts/run_tests.sh`,
ad-hoc topaz scripts in `/tmp`) and then exercised the `gemstone` MCP
server retroactively to compare. After my first-round notes, the server
shipped six new tools (`refresh`, `eval_python`, `compile_python`,
`list_test_classes`, `list_failing_tests`, `describe_test_failure`).
This document covers both rounds.

## Round 1 — pain points the MCP could replace

The CLI workflow's friction points:

1. **Full reinstall after every method tweak.** `./install.sh`
   recompiles all 114 classes (~30+ seconds) just to test a one-line
   change. Done 8–10 times in this session.
2. **Full test suite to check one class.** `./scripts/run_tests.sh`
   runs all 1497 tests when I only care about ~17 in
   `ClassCallFastPathTestCase`.
3. **Ad-hoc `/tmp/diag*.gs` scripts.** Every time I needed to inspect
   runtime state (`Python at: #PythonClass`, `methodDictForEnv:`,
   codegen output for a Python expression), I wrote a one-off
   `login`/`run`/`%`/`logout` topaz script in `/tmp` and parsed its
   output.
4. **`grep` over `src/smalltalk/`.** Worked, but found false positives
   in comments and tests, and is filename-grain instead of method-grain.

## Round 1 — what worked well

| Tool | Verdict | What it replaces |
|------|---------|------------------|
| `run_test_class` | **Big win.** Per-method PASSED/FAILED report, no parsing. | `run_tests.sh` for the iteration loop |
| `run_test_method` | Big win for "fix one failing test" cycles. | (no clean CLI equivalent) |
| `find_implementors` (with `environmentId: 1`) | Best-in-class. | grep over `__new__:` patterns gave false positives in comments and tests; the MCP returned the actual 14 class-side implementations cleanly |
| `find_senders` | Same idea; useful. | grep equivalent |
| `get_method_source` | Saved a `Read` + line-counting. | `Read` |
| `describe_class` | Looks promising; great as a "give me the shape of this class in one round trip." | `Read` of the entire `.gs` file |
| `list_methods` | Useful for orienting in a class. | grep + Read |
| `status` | Useful sanity check on session/transaction state. | (no equivalent) |

## Round 1 — what was rough

1. **`execute_code` rejects multi-statement input** unless wrapped in
   `[...] value`. `| x | x := 42. x + 1` errors with "expected start of
   a statement". Every diagnostic snippet I wrote needs the
   `[...] value` wrapper.

2. **Stale-transaction silently lies.** My MCP session showed
   `1497 run` (old state) right after `install.sh` had committed
   changes producing 1517. Calling `abort` explicitly fixed it.

3. **`find_implementors` defaults to `environmentId: 0`.** Almost
   everything Python-related lives in env 1. I asked "find `__new__:`"
   and got "No implementors found" when there are 14.

4. **Validator errors are not actionable.** `get_method_source` failed
   because `isMeta` was missing; the response was a raw JSON-schema
   "expected boolean, received undefined." Same with `run_test_method`
   — the parameter is `selector`, not `methodName`, and the error
   didn't suggest the right name.

5. **No bulk-source operations.** Refactoring 4 method definitions
   across 4 classes was 4 × (`Read` + `Edit`). `compile_method` is
   live-only; the on-disk `.gs` files are the source of truth a
   subsequent `install.sh` will read.

## Round 2 — the new tools

The server added six tools targeting most of my round-1 asks. Notes
from trying each:

### `refresh` — solid

```text
mcp__gemstone__refresh
→ refreshed
```

Solves the staleness story cleanly. Crucially, the description
explicitly says *"Refresh this session's view of committed state by
aborting if (and only if) there are no uncommitted changes."* That
guard is the right design — silent auto-abort would risk losing live
edits.

### `eval_python` — exactly what I wanted, with one rendering bug

```text
mcp__gemstone__eval_python source="2 + 3"           → 5
mcp__gemstone__eval_python source="[1, 2, 3]"        → anOrderedCollection( 1, 2, 3)
mcp__gemstone__eval_python source="print('hello')"   → None
mcp__gemstone__eval_python source="def factorial(n): ...; factorial(5)"  → 120
```

This single tool replaces the entire `/tmp/diag*.gs` workflow for
Python-level checks. Multi-line input works. End-to-end test of the
codegen pipeline as a side benefit.

**One rendering bug to fix.** Error returns come back with each
character followed by a space-like byte:

```text
mcp__gemstone__eval_python source="bool(1)"
→ "E r r o r :   M e s s a g e N o t U n d e r s t o o d  ..."
```

That's UTF-16LE leaking through the JSON layer. Successful results
(integers, OrderedCollections, `None`) are fine; only the error path
hits it. I'd guess the error formatter receives a `Unicode16`-class
string from `messageText` / `description` and the JSON encoder isn't
transcoding it to UTF-8. Fix: force-coerce the error string to
`Unicode7` / UTF-8 before returning, mirroring how the success path
already works.

### `compile_python` — a clean win for codegen inspection

```text
mcp__gemstone__compile_python source="bool(1)"
→ bool value: { (1). } value: nil.

mcp__gemstone__compile_python source="print(abs(-5))"
→ (((Python @env0:at: #builtins) instance) _print: { ((((Python @env0:at: #builtins) instance) abs: ((5) __neg__))). } kw: nil).
```

This is **the** tool for verifying codegen changes. In the previous
session I wrote a `generatedSourceFor:` Smalltalk helper in the test
case to extract the emitted source via `parseSource: → body → instVarAt:
→ first → value → printSmalltalkOn:`; with this tool, the test would
just call `compile_python` and string-match the result. Worth adding
test-case helpers that wrap it.

### `list_test_classes` — useful

Returns 113 test classes including SUnit infrastructure and the full
Python suite. Tab-separated `dictName \t className`. Pairs with
`list_failing_tests` for "run only this dictionary's tests."

### `list_failing_tests` — works, two issues

- **Calling without arguments fails.** The schema says
  *"With no classNames, discovers and runs every TestCase subclass in
  the symbolList,"* but both omitting the field and passing `[]`
  return `CompileError 1001, expected a primary expression`. I was
  forced to pass an explicit array of names.

- **Output is regression-friendly but the `message` column is just
  the SUnit debug recipe** (`ClassTestCase debug:
  #testCounterClassExists`). That's enough to triage which tests
  failed but doesn't say *why*. For the why I had to follow up with
  `describe_test_failure` per failure. Nine times out of ten I want
  the `messageText` inline so I can scan the failure list once and
  decide which to drill into. Suggested format:
  ```
  ERROR  ClassTestCase  testCounterClassExists  MessageNotUnderstood: nil does not understand #'contentsAsUtf8'
  ```

### `describe_test_failure` — exactly right

```text
status: error
exceptionClass: MessageNotUnderstood
errorNumber: 2010
messageText: a MessageNotUnderstood occurred (error 2010), a UndefinedObject does not understand  #'contentsAsUtf8'
description: ...
mnuReceiver: nil
mnuSelector: contentsAsUtf8
stackReport:
  MessageNotUnderstood (AbstractException) >> signal @2 line 47
  UndefinedObject (Object) >> doesNotUnderstand: @9 line 10
  ...
  importlib class >> astForPath: @4 line 8
  importlib class >> loadModuleFromPath:name: @2 line 17
  ClassTestCase >> setUp @10 line 10
```

This is the gold standard. Structured fields, MNU-specific `mnuReceiver`/
`mnuSelector` (huge — that's almost always what you want first), and a
stack trace pinpointing `importlib class >> astForPath: @4 line 8` as
the actual bug location. I would have spent 2–3 minutes parsing topaz
output to extract the same info.

## Net assessment after round 2

The MCP has gone from "useful for some queries" to "**clearly faster
than the CLI for the targeted edit-test cycle.**" `eval_python` +
`compile_python` + `describe_test_failure` together cover the bulk of
what I was previously doing through `/tmp` scripts and topaz-output
parsing.

Remaining gaps:

1. **Fix the UTF-16 leak in `eval_python` error returns.** Highest
   priority — currently the error path is unreadable.

2. **`list_failing_tests` with no args should work as documented**
   (run every TestCase). Today it errors instead of running the suite.

3. **`list_failing_tests` should include `messageText` in the
   `message` column,** not just the SUnit debug recipe.

4. **Also still useful:** `find_implementors` defaulting to
   `environmentId: 1` for projects that mostly live in env 1, and
   prefix/glob support in `run_test_class`.

## Withdrawn from round 1: `compile_method_from_file` / `save_to_file`

These were on my round-1 wishlist. After feedback from the Jasper
team and a re-think, I'm withdrawing both:

- The `.gs` file is the canonical source of truth; the stone is the
  derived artifact (`install.sh` reads files → produces stone state).
  After `compile_method`, the *stone* has drifted from canonical, not
  the file. `save_to_file` would write derived state back over
  canonical state — the wrong direction.

- `save_to_file` also creates a second write path into the same
  file. Even without an editor in the loop, "me via Edit" racing
  "me via save_to_file" loses track of which version reflects intent.

- `compile_method_from_file` is solved by `Read` + `compile_method`
  in two calls. The only thing a dedicated tool adds is parser-aware
  "extract method X from this file region," which is a small win.

The actual underlying ask is "let me skip `install.sh` when I only
changed one method," and the existing tools already cover that:
edit the file, push the same method to the live stone via
`compile_method`, run targeted tests against the live stone, and on
the next session let `install.sh` re-derive the stone from the file
canonically. The single-canonical-sync-direction invariant is worth
preserving.

## Bottom line

For the targeted edit-test cycle, the MCP after round 2 is clearly
faster than the CLI. For batch refactor + final validation, the CLI
remains the right path because it exercises the same machinery a human
will use. The natural division: **CLI for sweeps and final validation;
MCP for the targeted edit-test cycle.** The remaining issues are all
quality-of-result fixes (encoding, no-arg defaults, richer message
columns) rather than missing features.
