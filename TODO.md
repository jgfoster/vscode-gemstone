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
  `mnuReceiver` and `mnuSelector` for `MessageNotUnderstood`, and a multi-line `stackReport`
  with frames in `Class >> selector @ip line N [GsNMethod oop]` format. Stack capture is
  enabled by toggling `GemExceptionSignalCapturesStack` on around the run and restoring it
  via `ensure:` so the gem isn't left in a different state.
- Bug fix: `runTestClass.ts` and `runFailingTests.ts` were sending `each testCase class name`
  to objects that don't respond to `#testCase` (the items in `result failures` / `result errors`
  are TestCase instances themselves with only `testSelector` ivar). On a real failure the
  queries would silently DNU; tests mock the output so it wasn't caught. Now uses the direct
  `each class name` / `each selector`, matching the `passed` branch.
- `eval_python` / `compile_python` — register unconditionally on both surfaces, gracefully
  detect Grail (GemStone-Python) by `objectNamed:` lookup of `ModuleAst`. With Grail loaded:
  `eval_python` returns `(ModuleAst evaluateSource: src) printString`, `compile_python`
  returns `(ModuleAst parseSource: src) smalltalkSource`. Without Grail: returns a
  human-readable hint pointing at the missing class. Grail-side compile / runtime errors
  are caught and reported inline as `Error: <class> — <messageText>`. Direct class
  references (`ModuleAst evaluateSource: ...`) wouldn't work — that's a compile-time symbol
  in our query source, not a runtime send, so a missing `ModuleAst` would fail the parse
  before any handler could run. Dynamic resolution makes Grail's absence a runtime branch.

### Still open

(none)

### Rejected (with rationale)

- **`compile_method_from_file` + `save_to_file`.** The original feedback came from a Grail
  session running outside an editor, with a hot loop of `edit .gs file → install.sh
  (recompiles 114 classes, ~30s) → test`. The proposed tools were shortcuts around that
  install.sh roundtrip. Jasper's workflow is different: [fileInManager.ts](client/src/fileInManager.ts)
  already auto-files-in `.gs` saves to the running stone, so the agent's existing `Edit` tool
  + VS Code save covers the same need. Adding `save_to_file` would actively introduce a
  second write path competing with the editor's save handler — a stale-disk-vs-stale-stone
  race the existing pipeline already avoids. `compile_method_from_file` would offer
  parser-aware "extract just method X" extraction over what `Read` + `compile_method`
  already does, but the gap is small and not worth the new surface area for Jasper users.

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

