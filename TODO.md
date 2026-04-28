# Open Issues & Future Work

## MCP Server Feedback

External feedback (see `Grail/docs/MCP_Server_Feedback.md`) from a Claude Code session that
exercised the `gemstone` MCP server retroactively after a CLI workflow. Items grouped by impact.

### Shipped

- `execute_code` block-wraps input — multi-statement bodies and temp declarations parse.
- `find_implementors` / `find_senders` / `find_references_to` hint at env 1 when env 0 search is empty.
- `status`, `run_test_class`, `run_test_method`, `list_failing_tests` auto-refresh-if-clean
  before reading. New `refresh` tool exposes the same primitive explicitly.
- `list_failing_tests` (with optional `classNames`) runs the suite and returns only failures —
  iteration happens in Smalltalk so it's a single GCI round-trip.
- `list_test_classes` enumerates TestCase subclasses for filtering before `list_failing_tests`.
- Actionable validator errors. Per-schema zod error map (not global — global breaks the SDK's
  protocol parsing) rewrites missing-parameter and wrong-type messages to name the offending
  field, e.g. `"Missing required parameter 'isMeta' (expected boolean)."`. A typo like
  `methodName` for `selector` surfaces as a missing-required error on `selector`, which is
  enough for an agent to recover.
- `describe_test_failure` — re-runs a single test with its own `AbstractException` handler
  (bypasses `TestCase>>run`, which would swallow the exception) and returns structured details:
  `exceptionClass`, GemStone `errorNumber`, clean `messageText`, `description`, plus
  `mnuReceiver` and `mnuSelector` for `MessageNotUnderstood`. No stack trace in v1 — GemStone's
  exception classes don't expose `gemStackReport` or a populated `stack`/`stackReport` once the
  exception is caught past its dynamic context. The agent gets enough to diagnose most failures
  without re-reading the raw printString.

### Still open

- **`eval_python` / `compile_python`.** Given a Python source string, return the generated
  Smalltalk or the eval result. Closes the `/tmp/diag*.gs` gap for the GemStone-Python codegen
  path (Grail-style projects). *Out of scope for general Jasper unless Grail's surface lands here.*
- **`compile_method_from_file` + `save_to_file`.** Point at a `.gs` file + selector and recompile
  just that method, then write live changes back to disk. *Blocked by the proxy model — the MCP
  server doesn't have file-system access; the host extension would have to mediate.*
- **Stack trace in `describe_test_failure`.** AbstractException's `gsStack` ivar holds GemStone's
  internal stack representation, but `gemStackReport` / `stack` / `stackReport` accessors are
  unavailable or return nil on caught exceptions. A path may exist via `instVarAt:` on `gsStack`
  + custom formatting, or via running the test inside a `GsProcess` whose stack we can introspect.
  Probe needed.

## Bugs

- **`runTestClass.ts` and `runFailingTests.ts` send `each testCase class name` to TestCase
  instances that don't respond to `#testCase`.** Probe (see `describe_test_failure` work) showed
  that in this GemStone's SUnit, `result failures` and `result errors` contain the failed
  TestCase instance directly (only `testSelector` ivar) — `respondsTo: #testCase` returns false.
  On a real failure, the existing queries would DNU. The unit tests mock the output, which is
  why this hasn't been caught. Fix: use `each class name` and `each selector` (same as the
  `passed` branch already does).

## Ideas
- **Code Snippets** — Templates for common patterns: do:, collect:, ifTrue:ifFalse:, class definition boilerplate.
- **Lint / Warnings** — Flag common issues: unused temporaries, missing super sends in initialize, etc.
- **Bookmarks** — Pin frequently-visited methods for quick access (the Inspector view is close to this already).
- **Notebook API for Workspaces** — Smalltalk workspace with persistent bindings per cell.
- **Method History / Versions** — Surface GemStone method versions in a timeline view.
- **Split systemBrowser.ts** — Extract HTML and handlers into separate files.
- **Code Actions (Lightbulb)** — Quick fixes: "Define method", "Declare temp", "Extract to method".
- **Rename Symbol** — Rename a selector across all implementors and senders.
- **Inlay Hints** — Show return types and argument names inline.
- **Signature Help** — Keyword argument hints as you type.
- **Call Hierarchy** — Senders and implementors as incoming/outgoing call trees.
- **Debug Inline Values** — Show variable values inline during debugging.
- **Source Control API** — GemStone method versions as a timeline provider.
- **Workspace Variables** — Persistent bindings across evaluations (like Jade).
- **All Instances / References** — Jade-style object queries.
- **Breakpoint Conditions** — Conditional breakpoints and hit count breakpoints.
- **Transcript via ClientForwarderSend** — Real-time output using `System signal: 2336`.
- **System Administration** - Build the SysAdmin tools into VS Code

## Bugs

- **Browser "Delete Class" doesn't delete local `.gs` file** — `handleDeleteClass` in `systemBrowser.ts` removes the class from GemStone but does not delete the corresponding `.gs` file from disk. The file persists in the file explorer until the next export/refresh.

## Known Limitations

- **Detecting in-session commit/abort/continue**: If a user executes `System commit`, `System abort`, or `System continueTransaction` from a workspace (directly or indirectly via other code), the exported files become stale without the extension knowing. Possible approaches:
  - Poll `System transactionMode` periodically
  - Hook into GCI execution to inspect post-execution state
  - Require users to use the extension's commit/abort commands (document as limitation)

- **Multiple sessions with same credentials**: If two sessions are logged in with the same host/stone/user (and no per-login `exportPath`), they will share the same export directory. Edits in one session's files will be filed in to whichever session matches first. Use distinct `exportPath` templates on each login to avoid this.

## Deferred Optimizations

- **Method-level diffing**: Instead of filing in the entire class on save, diff against the previous version and only compile changed methods. Defer until whole-class file-in proves too slow.

