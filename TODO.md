# Open Issues & Future Work

## MCP Server Feedback

External feedback (see `Grail/docs/MCP_Server_Feedback.md`) from a Claude Code session that
exercised the `gemstone` MCP server retroactively after a CLI workflow. Items grouped by impact.

### Paper cuts (mislead the agent)

- **`execute_code` rejects multi-statement input.** `| x | x := 42. x + 1` errors with
  "expected start of a statement" because the body is wrapped as `(${code}) printString`.
  Wrap as a block (`[${code}] value printString`) so multi-statement / temp-var bodies parse,
  or document the requirement loudly in the tool description.
- **`find_implementors` / `find_senders` default to `environmentId: 0`.** Agents searching
  Python-heavy projects (env 1) get "No implementors found" when the method exists. Either
  surface an env hint in the empty-result message ("no implementors in env 0 — try env 1")
  or default differently per project.
- **Validator errors are not actionable.** Missing `isMeta` returns a bare zod
  "expected boolean, received undefined." `run_test_method` rejects `methodName` without
  suggesting `selector`. The MCP error wrapper should name the missing/misnamed parameter.

### Correctness (silent staleness)

- **Stale-transaction silently lies.** `status` and read tools reflected the session's
  pre-commit view (`1497 run`) after an external `install.sh` had committed (`1517 run`).
  Options: auto-`abort` before read-only calls when `System needsCommit` is false; surface
  `lastCommit` in `status`; or add an explicit `refresh` tool. Today the MCP can lie to the
  agent without any signal.

### New capabilities (rank order by ROI for an iteration loop)

1. **`run_test_class` with auto-abort / refresh** — implicit transaction refresh before running.
2. **`eval_python` / `compile_python`** — given a Python source string, return the generated
   Smalltalk or the eval result. Closes the `/tmp/diag*.gs` gap for the GemStone-Python codegen
   path (Grail-style projects).
3. **`list_failing_tests`** — full-suite run that returns only failures, structured
   (selector + error message + line), instead of having to grep `topaz` output.
4. **`run_test_class` accepting a prefix or pattern** — e.g. `Bytes*TestCase` to verify
   several related TestCase subclasses at once.
5. **`compile_method_from_file`** — point at a `.gs` file + selector and recompile just that
   method in the running stone. Avoids a full `install.sh` round-trip.
6. **`save_to_file`** — write a method just compiled live via `compile_method` back to the
   matching `.gs` file. Pairs with #5 to make MCP edits durable.
7. **`describe_test_failure`** — structured assertion message + exception class + line +
   stack frame for a failing test.

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

