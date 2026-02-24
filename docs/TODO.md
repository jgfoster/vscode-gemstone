# Open Issues & Future Work

## Known Limitations

- **Detecting in-session commit/abort/continue**: If a user executes `System commit`, `System abort`, or `System continueTransaction` from a workspace (directly or indirectly via other code), the exported files become stale without the extension knowing. Possible approaches:
  - Poll `System transactionMode` periodically
  - Hook into GCI execution to inspect post-execution state
  - Require users to use the extension's commit/abort commands (document as limitation)

## Deferred Optimizations

- **Method-level diffing**: Instead of filing in the entire class on save, diff against the previous version and only compile changed methods. Defer until whole-class file-in proves too slow.

## System Browser

### Context Menus in Webview Columns
Re-add mutation commands as context menus on the webview columns:

- **Dictionary column**: Add Dictionary, Move Up, Move Down
- **Class Category column**: New Class Category
- **Class column**: Delete Class, Move to Dictionary, Run SUnit Tests, Inspect Global, New Class
- **Method Category column**: New Method, Rename Category
- **Method column**: Delete Method, Move to Category, Senders Of, Implementors Of, New Method

### Drag-and-Drop in Webview
- Drag methods between categories to recategorize
- Drag classes between dictionaries to move

### Multiple Environments
When `gemstone.maxEnvironment > 0`, show environment tabs or a selector in the method categories column to browse methods in environments 0 through N.

## Inspector

### Non-Class Globals
Display non-class globals (from `getDictionaryEntries()` where `isClass: false`) in the Inspector tree view. This would provide a way to navigate and inspect global objects that are not classes (e.g., `AllUsers`, `UserProfile`).
