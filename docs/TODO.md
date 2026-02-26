# Open Issues & Future Work

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

## Bugs

- **Browser "Delete Class" doesn't delete local `.gs` file** — `handleDeleteClass` in `systemBrowser.ts` removes the class from GemStone but does not delete the corresponding `.gs` file from disk. The file persists in the file explorer until the next export/refresh.

## Known Limitations

- **Detecting in-session commit/abort/continue**: If a user executes `System commit`, `System abort`, or `System continueTransaction` from a workspace (directly or indirectly via other code), the exported files become stale without the extension knowing. Possible approaches:
  - Poll `System transactionMode` periodically
  - Hook into GCI execution to inspect post-execution state
  - Require users to use the extension's commit/abort commands (document as limitation)

## Deferred Optimizations

- **Method-level diffing**: Instead of filing in the entire class on save, diff against the previous version and only compile changed methods. Defer until whole-class file-in proves too slow.

