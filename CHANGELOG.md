# Changelog

All notable changes to the **GemStone Smalltalk** extension will be documented in this file.

## [Unreleased]

## [1.0.4] - 2026-02-19

### Added

- **SUnit Test Runner** — integrates with VS Code's native Test Explorer via the Test API; discovers all `TestCase` subclasses in the user's symbol list and their `test*` methods; run individual tests or entire test classes with pass/fail/error reporting and failure messages; test items link to method source via `gemstone://` URIs; right-click a class in the browser tree to run its SUnit tests; auto-discovers tests on session activation; refresh button in Test Explorer header
- **Line-based breakpoints** — click the gutter in a `gemstone://` method to set/clear breakpoints; maps editor lines to GemStone step points via `_sourceOffsets`; breakpoints are managed per-method and cleared on recompile
- **Selector breakpoints** — right-click a selector in a `gemstone://` method and choose "Toggle Selector Breakpoint" to set a breakpoint on that specific step point; breakpointed selectors are highlighted with a red border decoration; supports multi-keyword selectors (e.g., `assert:equals:` highlights all keyword parts); underscores recognized in selectors
- **Debug-enabled code execution** — Display It, Execute It, and Inspect It now pass `GCI_PERFORM_FLAG_ENABLE_DEBUG` so breakpoints fire during execution; errors offer a "Debug" button to open the VS Code debugger
- **Multi-environment method dictionaries** — new `gemstone.maxEnvironment` setting controls how many method environments are displayed (default 0 shows standard Smalltalk only; higher values show additional environments, e.g., Python)
- **Drag-and-drop in browser tree** — drag methods to a different category to recategorize them; drag classes to a different dictionary to move them; drag classes to a class category to reclassify them; validates same class/side/environment for method moves and rejects drops on synthetic categories
- **New Class Category command** — `+` button on dictionary nodes prompts for a category name, then opens a new-class template pre-filled with that category
- **Class categories in browser** — dictionaries now group classes by category with `** ALL CLASSES **` and `** OTHER GLOBALS **` synthetic categories; named categories show a `+` button for creating new classes in that category
- **`** ALL METHODS **` method category** — each side node includes a synthetic `** ALL METHODS **` category that lists every method alphabetically, making it easy to find methods without knowing their category
- **Index-based dictionary lookup** — all dictionary interactions (class lookup, delete, move, reclassify, reorder) now use the SymbolList index rather than name, avoiding ambiguity when two dictionaries share the same name
- **Bulk environment query** — single-round-trip `_unifiedCategorys:` query fetches all categories and selectors per environment, reducing GCI calls for remote databases
- **Object Inspector** — new sidebar tree view for inspecting GemStone objects with drill-down into named instance variables and indexed elements; pin objects via **Inspect It** (Cmd+I) or by clicking globals in the browser; reuses debugger's GCI introspection infrastructure
- **Senders Of / Implementors Of** — right-click a method in the browser tree or use the editor context menu to find senders or implementors across all dictionaries; results open in a QuickPick list and clicking an entry opens the method source
- **Token-aware selector detection** — Senders Of / Implementors Of in the editor use the language server to identify the selector at the cursor position, correctly composing multi-keyword selectors (e.g., `at:put:`)
- **Class Hierarchy** — right-click a class in the browser tree to view its superclass chain and subclasses in a QuickPick list; selecting an entry opens the class definition
- **Search Method Source** — toolbar button in the browser view to search method source code across all dictionaries using a GCI `includesString:` query
- **Workspace Symbol Provider** — Cmd+T / Ctrl+T now includes classes and methods from the active GemStone session alongside local file results
- **Browser tree sync** — the browser tree view automatically selects and reveals the node corresponding to the active `gemstone://` editor tab (methods, definitions, and comments); works with Senders Of, Class Hierarchy, back/forward navigation, and clicking tabs
- **LSP support for `gemstone-smalltalk`** — browser documents (`gemstone://` URIs) now get language server features: hover, completion, go-to-definition, find references, and diagnostics
- **Go to Definition** — Cmd+Click or F12 on a selector jumps to its implementor(s) via GCI; for class names, jumps to the class definition; uses the same LSP-based selector resolution as Senders/Implementors
- **Hover Documentation** — hovering over a selector shows its implementor count with class names and categories; hovering over a class name shows its dictionary and class comment (truncated to 500 chars)
- **Autocompletion** — GCI-backed `CompletionItemProvider` supplements LSP completions with class names from the image, instance variable names for the current class, and the full selector protocol (own + inherited); results are cached per session and class

## [1.0.3] - 2026-02-16

### Added

- **GCI library integration** — load the GemStone C Interface (`libgcits`) at runtime via [koffi](https://koffi.dev/) FFI; wrapper in `client/src/gciLibrary.ts` exposes 98 GCI functions covering login/logout, transactions, object creation/fetch/store, execution, compilation, traversal, debugging, and host utilities
- **Session management** — login button on saved logins now establishes a live GCI session; new **Sessions** tree view in the GemStone sidebar shows active connections with inline **Commit**, **Abort**, and **Logout** buttons; sessions are cleanly logged out on extension deactivation
- **GCI integration test suite** — separate vitest config (`vitest.gci.config.ts`) and `npm run test:gci` script for tests requiring the native library; 171 tests across 16 test files
- **GCI library file validation** — the login flow now validates the selected library filename against the expected `libgcits-<version>-64.<ext>` pattern
- **Login management UI** — sidebar tree view, editor panel for add/edit/duplicate/delete logins, stored in VS Code global settings
- **GCI documentation headers** — `docs/gcits.hf` and `docs/gcits.ht` for reference
- **Display It / Execute It** — execute Smalltalk code from the editor against a live GemStone session; Cmd+D inserts the `printString` result inline (with italic decoration), Cmd+E executes silently; non-blocking execution with exponential-backoff polling, progress notification after 2 seconds with soft/hard break support
- **Session selection** — selected session concept for keyboard-driven code execution; auto-selects when only one session exists, QuickPick prompt for multiple sessions; status bar item shows active session; tree view highlights selected session with distinct icon
- **Class/method browser** — sidebar tree view (Dict → Class → Definition/Comment/Instance/Class → Category → Method) with `gemstone://` virtual filesystem; click a method to open and edit in the standard editor, Cmd+S compiles; class definitions and comments are also editable documents
- **Browser operations** — new class (template), new method (template), delete method, move method to category, rename category, remove class, move class between dictionaries, add dictionary, reorder dictionaries; all accessible from tree context menus and inline buttons
- **GCI Output Channel** — all GCI queries, results, and errors are logged to a "GemStone" output channel for debugging; session login/logout events are also logged
- **Language ID reorganization** — `gemstone-topaz` for `.gs`/`.tpz` (Topaz files), `gemstone-smalltalk` for bare Smalltalk (browser documents, scratch files), `gemstone-tonel` for `.st` (Tonel files)
- **Tonel file format support** — `.st` files are now parsed as Tonel format (used by GemStone's Rowan package manager), while `.gs` and `.tpz` remain Topaz format
- New `gemstone-tonel` language ID with dedicated TextMate grammar and language configuration
- Tonel parser handles Class, Extension, and Package files with STON metadata headers
- Method bodies in Tonel files get full LSP support: hover, completion, go-to-definition, find references, document symbols, workspace symbols, diagnostics, and folding
- Tonel methods are included in the workspace index for cross-file implementor/sender lookup
- Bracket-aware method body extraction (correctly handles nested blocks, strings, and comments)
- **Debugger** — VS Code Debug Adapter Protocol (DAP) integration for debugging GemStone errors; when code execution hits an error, a "Debug" button offers to open the VS Code debugger with full stack trace, source viewing, variable inspection, stepping, continue, and expression evaluation
  - Stack trace with `ClassName>>#selector` frame names and source references
  - Click any frame to view its method source with GemStone (Smalltalk) syntax highlighting
  - "Executed Code" frame for doit expressions that triggered the error
  - Arguments & Temps scope and Receiver scope with drill-down into named/indexed instance variables
  - Step Over, Step Into, Step Out via blocking GCI calls (`gciStepOverFromLevel:` etc.)
  - Continue execution via `GciTsContinueWith` (resumes process; re-enters debug on subsequent errors)
  - Evaluate expressions in the Debug Console in the context of any stack frame
  - Restart Frame support via `trimStackToLevel:`
  - Disconnect clears the suspended GsProcess stack

## [1.0.2] - 2026-02-13

### Added

- **Workspace method index** — on startup, scans all `.gs`, `.st`, and `.tpz` files and builds an in-memory index of method selectors, class names, and message sends; incrementally updated on every edit and file-system change
- **Workspace Symbol search** (Ctrl+T / Cmd+T) — find methods across all files by selector or class name (e.g., `at:put:`, `Foo >> bar`)
- **Go to Implementors** — Cmd+click (or F12) on a message send jumps to its implementors across the workspace; correctly composes keyword selectors (`at:` vs `at:put:`)
- **Find Senders** (Find All References) — right-click a selector to find all methods that send it across the workspace
- **Configurable formatter** with settings under `gemstoneSmalltalk.formatter.*`:
  - `spacesInsideParens`, `spacesInsideBrackets`, `spacesInsideBraces`
  - `spacesAroundAssignment`, `spacesAroundBinarySelectors`, `spaceAfterCaret`
  - `blankLineAfterMethodPattern`
  - `maxLineLength` (line wrapping, 0 = off)
  - `continuationIndent` (for multi-line keyword messages)
  - `multiKeywordThreshold` (when to split keyword messages across lines)
  - `removeUnnecessaryParens` (based on Smalltalk message precedence)

### Fixed

- Hover tooltips now correctly identify instance/class variables as "variable" instead of "unary selector"

## [1.0.1] - 2026-02-10

### Fixed

- Fixed false positive "Expected ']' to close block" errors
- Fixed false positive "Expected ')' to close parenthesized expression" errors

## [1.0.0] - 2026-02-08

### Added

- GemStone Smalltalk syntax highlighting for `.gs`, `.st`, and `.tpz` files
- Topaz command language support with highlighting for 40+ commands (`run`, `doit`, `printit`, `commit`, `abort`, `login`, `logout`, `set`, `display`, `method`, `classmethod`, `category`, `fileout`, `filein`, and more)
- Topaz code block recognition for `run`, `doit`, `printit`, `method`, and `classmethod` blocks
- Smalltalk language constructs: strings, symbols, numbers, characters, arrays, byte arrays, booleans, `nil`, block syntax, pragmas, assignments, returns, and cascades
- Pseudo-variable highlighting for `self`, `super`, and `thisContext`
- Class and global variable recognition (capitalized identifiers)
- Double-quote comment syntax support
- Language configuration with bracket matching, auto-closing pairs, folding markers, and smart indentation
- Language Server Protocol (LSP) client/server architecture for advanced editor features
