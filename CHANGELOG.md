# Changelog

All notable changes to the **GemStone Smalltalk** extension will be documented in this file.

## [Unreleased]

## [1.1.1] - 2026-03-02

### Fixed

- **Linux support** — extension now runs on Linux in addition to macOS
- Pre-load `libnetldi` with `RTLD_GLOBAL` on Linux so the GCI library can resolve `HostCreateThread`
- Include the `koffi` native module in the packaged extension (`.vscodeignore` fix)
- Set `GEMSTONE` and `GEMSTONE_GLOBAL_DIR` environment variables at login so the in-process GCI library can locate the NetLDI lock file
- Reset the open-file limit (`ulimit -n 1024`) when spawning GemStone processes on Linux to prevent shared page cache sizing issues caused by Electron's high default limit
- Replace `curl`-based version download with native Node.js `https` (with redirect handling) for portability
- Use `spawnSync` instead of `execSync` for `unzip` with proper error handling

### Changed

- **Configure OS** view (formerly "Shared Memory") — now available on Linux in addition to macOS; detects shared memory via `sysctl kernel.shmmax`/`kernel.shmall` on Linux
- **RemoveIPC check** (Linux) — detects whether `RemoveIPC=no` is set in systemd logind configuration; provides a one-click setup script to prevent systemd from destroying GemStone shared memory on logout

## [1.1.0] - 2026-02-28

### Added

- **GemStone SysAdmin** — manage GemStone infrastructure directly from VS Code without needing a separate tool
- **Shared Memory view** (macOS) — detects whether macOS shared memory is configured for GemStone (requires 4 GB); when not configured, provides a one-click setup script that installs a LaunchDaemon plist
- **Version management** — browse available GemStone versions from the GemTalk downloads site; download, extract (automatic DMG mounting on macOS, unzip on Linux), and delete versions; supports both ARM and x86 on macOS and Linux
- **Database management** — create new databases via a multi-step wizard (select version, base extent, stone name, NetLDI name); automatically generates directory structure, configuration files, and copies the extent and key file; delete databases with safety checks
- **Start/Stop Stone** — start and stop GemStone stone processes with full environment configuration; inline tree view buttons with running/stopped status indicators
- **Start/Stop NetLDI** — start and stop NetLDI network listener processes; displays port number when running
- **Replace Extent** — replace a stopped stone's database extent with a fresh base extent; removes old extent and transaction logs
- **Process list** — view all running GemStone processes (stones and NetLDIs) parsed from `gslist -cvl` output with PID and port information
- **Database tree view** — hierarchical view showing each database with its stone status, NetLDI status, expandable log files, and expandable config files; click any file to open it in the editor
- **Open Terminal** — open a VS Code terminal pre-configured with all GemStone environment variables (`GEMSTONE`, `PATH`, `DYLD_LIBRARY_PATH`, etc.) and working directory set to the database path
- **Reveal in Finder** — open the database directory in the system file manager
- **Create Login from Database** — create an IDE login configuration pre-filled with the database's version, stone name, NetLDI, and auto-detected GCI library path
- **SysAdmin output channel** — all admin operations (create, delete, start, stop) are logged to the "GemStone Admin" output channel
- **Per-login export path template** — each login now has an optional `exportPath` field that accepts a template with variables `{workspaceRoot}`, `{host}`, `{stone}`, `{user}`, `{index}`, `{dictName}`; the per-login template takes precedence over the global `gemstone.exportPath` setting
- **User-managed dictionaries** — new `gemstone.userManagedDictionaries` setting lists dictionary names that the extension will never overwrite during export
- **Configurable export root** — `gemstone.exportPath` setting supports `{workspaceRoot}` variable substitution, absolute paths, and paths relative to the workspace root

### Changed

- Removed login reconciliation on connect (local/server conflict detection); replaced by user-managed dictionaries for controlling which dictionaries are owned by the developer
- Consolidated `language-configuration-tonel.json` into `language-configuration.json` (identical contents)

## [1.0.5] - 2026-02-26

### Added

- **File-based class browser** — export classes in Topaz format to the file system; open and edit classes with the standard VS Code file explorer; System Browser webview with five-column layout (dictionaries, class categories, classes, method categories, methods) with file editor below
- **Multiple browser windows** — each "Open Browser" creates a new panel; tab title updates to `Browser: ClassName` when a class is selected
- **Login export reconciliation** — on login, detects conflicts between local files and the GemStone image; offers Use Local, Use Server, Show Differences, or Skip options
- **New class template** — creating a `.gs` file in a dictionary directory auto-fills a class template and files it in to GemStone
- **Hierarchy view** — toggle between category and hierarchy views in the browser; shows superclass chain and subclasses
- **Context menus** — right-click dictionaries, classes, method categories, and methods for actions (add, delete, move, rename, run tests, inspect, senders, implementors, browse references)
- **Browse References** — right-click a dictionary or class to find all methods that reference that object via `ClassOrganizer >> referencesToObject:`
- **Drag-and-drop** — drag methods to recategorize; drag classes between dictionaries
- **Inspect non-class globals** — selecting a global in the `** GLOBALS **` category opens the object inspector
- **Multiple method environments** — `gemstone.maxEnvironment` setting controls how many method environments are displayed
- **Transcript channel** — GemStone Transcript output routed to a VS Code output channel
- **Semantic tokens** — language server provides semantic token highlighting for Smalltalk method source
- **Code lens** — inline code lens annotations in Smalltalk source files
- **Custom dictionary inspector** — inspector tree view supports drilling into SymbolDictionary entries
- **Large collection pagination** — inspector paginates large indexed collections instead of loading all elements at once

### Changed

- Dictionary directories renamed from `N. DictName` to `N-DictName` to avoid spaces in file paths (improves Topaz compatibility)
- Method reveal scrolls to top of editor pane instead of center when selecting a method in the browser

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
