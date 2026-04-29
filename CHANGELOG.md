# Changelog

All notable changes to the **GemStone Smalltalk** extension will be documented in this file.

## [Unreleased]

### Changed

- **Default class export directory is now hidden** — exports default to `{workspaceRoot}/.gemstone/{session}/{index}-{dictName}` (was `{workspaceRoot}/gemstone/...`). The dot-prefix keeps it out of the way in file listings while remaining browseable in VS Code's Explorer, Quick Open, and Find in Files. Users with an existing `gemstone/` directory can either delete it or pin the prior layout via the `gemstone.exportPath` setting (e.g. `{workspaceRoot}/gemstone/{session}/{index}-{dictName}`).

## [1.4.3] - 2026-04-29

### Fixed

- **`Utf8 at:put:` regression in `eval_python` / `compile_python` error path and `list_failing_tests`.** The 1.4.2 fix for the UTF-16 leak treated `Utf8` as if it were an internal storage class and switched the error formatter to `WriteStream on: Utf8 new`. But `Utf8` is a transfer-protocol class — variable-byte, no character indexing, `at:put:` and `copyFrom:to:` undefined — so buffer growth raised `rtErrShouldNotImplement` on every error case. The right model is to build the full output in an internal Unicode class (Unicode7 transparently widens to Unicode16/Unicode32 as needed for non-ASCII codepoints), then call `asUtf8` once at the boundary to produce the transfer-protocol bytes GCI hands back. Lossless, simpler, and matches GemStone's intent.

### Changed

- **`run_test_method` / `run_test_class` message column now carries the actual exception** (`MessageNotUnderstood: nil does not understand #foo`) instead of the SUnit debug recipe (`ClassTestCase debug: #testFoo`). Bypasses `TestCase>>run` and replicates `setUp` / `perform` / `tearDown` with our own `AbstractException` handler — same pattern `describe_test_failure` uses, now applied to the iterating runners. Round-2 ask #3 (originally about `list_failing_tests`) applied here too.

## [1.4.2] - 2026-04-28

### Added

- **`list_failing_tests` `classNamePattern` parameter** — glob-filter discovered TestCase subclasses (`*` = any chars, `#` = one char) before running. E.g. `classNamePattern: "Bytes*TestCase"` runs every `Bytes*TestCase` in one round-trip. Composes with the existing `classNames` array (explicit names still win).
- **`list_failing_tests` message column now carries actual exception details** — `MessageNotUnderstood: nil does not understand #foo` instead of the SUnit debug recipe `ClassTestCase debug: #testFoo`. Each failing/erroring test is re-run with its own `AbstractException` handler to capture the live exception's `messageText`. Iteration stays in Smalltalk so it's still one GCI round-trip.

### Changed

- **`find_implementors` / `find_senders` / `find_references_to` auto-fall-back to env 1** when no `environmentId` is given and env 0 returns empty. Projects whose user code lives in env 1 (notably GemStone-Python) no longer get a misleading "no implementors found" when the method exists. Pass `environmentId` explicitly to limit to one environment.

### Fixed

- **UTF-16LE leak in `eval_python` / `compile_python` error returns.** Grail-side compile/runtime errors came back as `"E r r o r :   M e s s a g e N o t U n d e r s t o o d ..."` — `messageText` returns `Unicode16` for system errors, `, ` concatenation widened the result to Unicode16, and GCI's `Utf8`-class fetch forwarded the UTF-16LE bytes raw. The error string is now built through a `WriteStream on: Utf8 new`, which forces transcoding on write.
- **`list_failing_tests` with no arguments raised `CompileError 1001`.** The `DISCOVER_ALL_TEST_CLASSES` Smalltalk fragment had its own `| sl seen list |` temps, which can't appear inside `classes := <expr>`. The fragment is now wrapped as `[| sl seen list | ...] value` so it's a valid expression in any position.

## [1.4.1] - 2026-04-27

### Added

- **MCP `refresh` tool** — explicitly refresh the session's view of committed state (aborts only when no uncommitted changes are pending). Closes the silent-stale gap where the GCI pinned a session's read view to its transaction snapshot, so commits landed by another process (e.g. `install.sh`) were invisible until the session aborted or committed.
- **MCP `list_failing_tests` tool** — runs SUnit tests and returns only the failed/errored entries. Optional `classNames` filter for targeted subsets (otherwise discovers every TestCase subclass in the symbolList). Iteration runs in Smalltalk so an N-class invocation is one GCI round-trip.
- **MCP `list_test_classes` tool** — discovery primitive for filtering before `list_failing_tests`.
- **MCP `describe_test_failure` tool** — re-runs a single test with its own `AbstractException` handler (bypasses `TestCase>>run`, which would swallow the exception) and returns structured details: `exceptionClass`, GemStone `errorNumber`, clean `messageText`, `description`, plus `mnuReceiver` / `mnuSelector` for `MessageNotUnderstood`. Includes a multi-line `stackReport` when stack capture is supported (gem-level `GemExceptionSignalCapturesStack` is toggled around the run and restored via `ensure:`).
- **MCP `eval_python` and `compile_python` tools** — compile/transpile/execute Python source via Grail (GemStone-Python). Register unconditionally; gracefully report "Grail not detected" via runtime `objectNamed:` lookup when Grail isn't loaded. Grail-side compile and runtime errors are reported inline as `Error: <class> — <messageText>`.

### Changed

- **`status`, `run_test_class`, `run_test_method`, `list_failing_tests`, `describe_test_failure` auto-refresh-if-clean** before reading. Discards the stale-pinned view when (and only when) no uncommitted work is pending. `status` reports the new view state on a `View:` line.
- **`execute_code` accepts multi-statement bodies** — wrapped as `[<code>] value printString` so `| x | x := 42. x + 1` parses. Previously errored with "expected start of a statement" because the wrapper only accepted a single expression.
- **`find_implementors` / `find_senders` / `find_references_to` empty-result message hints at env 1** — projects whose user code lives in `environmentId: 1` (notably GemStone-Python) were getting a bare "No implementors found" that was easy to misread as "doesn't exist."
- **MCP tool validator errors name the offending parameter** — replaces zod's bare `"Invalid input: expected boolean, received undefined"` with `"Missing required parameter 'isMeta' (expected boolean)."` and `"Parameter 'isMeta' must be boolean, but received string."`. Implemented as a per-schema error map (a global one breaks the SDK's discriminated-union JSON-RPC parsing).

### Fixed

- **`runTestClass` / `runFailingTests` were sending `each testCase class name` to objects that don't respond to `#testCase`** — the items in `result failures` and `result errors` are TestCase instances themselves with only a `testSelector` ivar, not wrapper objects. On a real failure the queries would silently DNU; tests mocked the output so it wasn't caught. Now uses `each class name` / `each selector`, matching the `passed` branch.

## [1.4.0] - 2026-04-26

### Added

- **MCP HTTPS/SSE surface for URL-based connectors** — Jasper now serves the gemstone MCP server at `https://127.0.0.1:27101/sse` (port configurable via `gemstone.mcp.httpPort`) for clients whose connector UI takes a URL rather than a command to spawn (e.g. Claude Desktop's "Add custom connector" dialog). Uses the same `getSelectedSession()` routing as the stdio surface, so all 27 tools run against the user's currently active session. Binds 127.0.0.1 only — never exposed off-host.
- **Self-signed TLS certificate** — Generated on first activation and stored in the extension's global storage directory (shared across workspaces). Valid for `127.0.0.1` and `localhost`, 10-year validity, written with `0600` permissions. Required because Claude Desktop rejects plain-http URLs.
- **`GemStone: Install MCP TLS Certificate`** command — Palette action that surfaces the platform-specific trust-store install command (`security add-trusted-cert` on macOS, `certutil -user -addstore Root` on Windows, NSS db `certutil -A` on Linux) and offers to run it in a terminal, copy it to the clipboard, or copy the cert path.
- **`GemStone: Copy MCP Server URL`** command — One-click copy of the HTTPS URL for pasting into a connector dialog.
- **Claude Desktop auto-registration** — On activation, Jasper writes a per-workspace `gemstone-<hash>` entry into Claude Desktop's global `claude_desktop_config.json` and removes it on deactivation. Gated by `gemstone.mcp.registerWithClaudeDesktop` (default `true`).
- **Claude Code registration via `claude mcp add`** — Replaces the previous `.claude/settings.local.json` write with a `claude mcp add` invocation that targets `~/.claude.json`'s per-project scope (the location Claude Code actually reads). No-op when the `claude` CLI isn't on PATH.

### Changed

- **`Open MCP Inspector` is now a command-palette action** that points at the live HTTPS/SSE surface, replacing the per-database "MCP Server" tree row that previously spawned an isolated subprocess per stone with its own credentials. The Inspector terminal receives `NODE_EXTRA_CA_CERTS` so Node's TLS stack trusts Jasper's self-signed cert (the OS keychain trust does not extend to Node).

### Removed

- **Per-database "MCP Server" tree row** and the `gemstone.startMcpServer` / `gemstone.stopMcpServer` commands and their menu contributions. Superseded by the always-on HTTPS/SSE surface (net –846 lines).

### Fixed

- **Tonel method signature semantic tokens landing on the wrong column** — the selector column offset was not being threaded through `collectSemanticTokens`, causing semantic highlighting to land on the wrong column for the first line of Tonel method signatures. Thanks to @ericwinger (#52).

## [1.3.4] - 2026-04-22

### Added

- **WSL networking detection and configuration (Windows only)** — OS Configuration now surfaces a **WSL networking** row showing whether WSL is running in `networkingMode=mirrored` (where `localhost` on Windows reaches services inside WSL) or NAT mode. Detection reads `%USERPROFILE%\.wslconfig`, and `wsl --version` determines whether the installed WSL core is ≥ 2.0 (the minimum that supports mirrored mode).
- **Enable mirrored networking action** — when WSL core is ≥ 2.0 but NAT is active, a one-click action writes `networkingMode=mirrored` into `%USERPROFILE%\.wslconfig` (preserving existing sections, keys, comments, and line endings) and prompts to run `wsl --shutdown` so the change takes effect.
- **Update WSL core action** — when WSL core is < 2.0, a one-click action opens a terminal and runs `wsl --update`, then refreshes the OS Configuration state on terminal close.
- **Hosts-file fallback for Windows 10 / NAT** — under NAT networking, Jasper can write `<wsl-ip> wsl-linux` to `C:\Windows\System32\drivers\etc\hosts` so logins can use `wsl-linux` instead of a raw IP. The PowerShell script self-elevates via UAC and is idempotent — re-run it after each `wsl --shutdown` or Windows restart.
- **Services-file configuration** — detects whether `gs64ldi 50377/tcp` is present in `/etc/services` on Windows and inside WSL, and offers separate write actions for each side (PowerShell + UAC for Windows, `sudo` for WSL). With the entry in place, `startnetldi` binds to the conventional port 50377 and logins can name the port as `gs64ldi`.
- **NetLDI host tooltip and Copy Host action** — running NetLDI items on Windows+WSL now show a `Host:` line in their tooltip (`localhost` under mirrored networking, the current WSL IP otherwise) and expose a **Copy Host** inline/context action that writes the host to the clipboard for pasting into a login's Host field.

## [1.3.3] - 2026-04-19

### Fixed

- **WSL Support** — WSL support (Linux in Windows) now mostly works.
- **MCP Inspector launch on Windows** — the "Open MCP Inspector" button now invokes `npx.cmd` instead of `npx` on Windows, bypassing the `npx.ps1` PowerShell ExecutionPolicy block that prevented the inspector from starting.
- **`status` MCP tool on GemStone 3.7.x** — the Smalltalk query no longer calls `System stoneVersionReport` (which could return a SmallInteger, causing `does not understand #'do:'`) or `System modifiedObjects` (absent in some versions); it now reports user, stone, session, transaction state, and uncommitted-changes flag via reliable methods, with every streamed value coerced to a string.
- **Tree-view commands crashing from the Command Palette** — handlers for `gemstone.stopStone` and 8 other commands read `node.kind` without a guard, crashing with `Cannot read properties of undefined (reading 'kind')` when invoked from the palette (where `node` is `undefined`). All handlers now use optional chaining, and a source-scan regression test keeps them guarded.

## [1.3.2] - 2026-04-17

### Added

- **Windows client distribution support** — Jasper can now automatically download and extract the native Windows GCI client library (`libgcits-{version}-64.dll`) for connecting to remote GemStone servers from Windows without WSL. Available as a standalone **Download Windows Client** button in the Versions view and as an automatic prompt during login when the library is missing.
- **GCI auto-detection for Windows client** — the login flow checks extracted Windows client distributions (`GemStone64BitClient{version}-x86.Windows_NT/bin/`) before prompting the user to browse for a library.
- **Quick Setup downloads Windows client** — on Windows, Quick Setup now downloads and extracts both the WSL server distribution and the native Windows client distribution, then auto-registers the GCI library path.
- **Login editor shows Windows client versions** — the version dropdown in the login editor includes versions from extracted Windows client distributions on Windows.
- **Graceful handling of missing GCI functions** — the GCI library loader now tolerates functions absent from the Windows client DLL (`GciTsNbLogin`, `GciTsNbLogin_`, `GciTsNbLoginFinished`, `GciTsDebugConnectToGem`, `GciTsDebugStartDebugService`); calling them throws a descriptive error instead of failing at load time.

### Changed

- **README rewritten for Windows users** — Getting Started now leads with the simpler "connect to an existing server" path before the full local setup; new Windows Usage section explains client-only and WSL configurations; platform support table at the top.
- **`tar` instead of PowerShell for Windows extraction** — Windows client zip extraction uses `tar -xf` (built into Windows 10+) instead of `Expand-Archive`, avoiding PowerShell execution policy issues.
- **VS Code tasks use `cmd.exe` on Windows** — build tasks now specify `cmd.exe` as the shell on Windows to avoid `npm.ps1` execution policy errors.

## [1.3.1] - 2026-04-16

### Changed

- **MCP stdio now routes to the user's current session** — Jasper's extension host opens a local socket on activation and writes `.claude/settings.local.json` automatically; the MCP server runs as a thin proxy that forwards each tool call into the extension host, so Claude Code (and any other MCP client) sees exactly the session you are working in. No separate login, credentials, or keychain entries are required for the MCP flow. If no session is selected, tools return an error Claude can handle gracefully.
- **Removed "Configure Claude Code" setup** — no longer needed; the stdio MCP server is available as soon as a workspace is open.
- **Shared query layer (`client/src/queries/`)** — every GemStone query (read and write) now lives in a shared module parameterized by a `QueryExecutor` function. Both MCP surfaces (stdio proxy and SSE) and Jasper's own IDE code delegate through the same Smalltalk composition and result-parsing logic. Eliminates all duplicated inline Smalltalk between the client and MCP server.
- **`compileMethod` switched from GCI primitives to pure Smalltalk** — now uses `Behavior>>compileMethod:dictionaries:category:environmentId:` via the shared query layer instead of low-level GCI calls (`GciTsCompileMethod`, `GciTsPerform`, `GciTsNewString`, `GciTsNewSymbol`); returns a confirmation string instead of a method OOP (no caller used the OOP). Compile errors propagate through the GCI error path with line/position details as before.
- **`fileOutClass` uses global lookup by default** — resolves classes via `objectNamed:` across the symbolList instead of requiring a dictionary index. Optional `dict` parameter targets a specific dictionary when needed (e.g., export manager walking dicts to handle shadowed names correctly).
- **Class browser loads data in one round trip** — the class definition panel now fetches definition, comment, superclass dictionary name, and write-permission in a single GemStone query (`loadClassInfo`) instead of four separate calls.

### Added

- **Keychain-backed login passwords** — the login editor has a "Store password in OS keychain" checkbox. When enabled, the password is saved to the OS keychain (macOS Keychain, Windows Credential Vault, Linux libsecret) via `keytar`, keyed by `${user}@${host}/${stone}`; the settings file stores an empty password and a `password_in_keychain` flag. Editing the login reads the password back from the keychain; unchecking the box migrates the entry back to plaintext and deletes the keychain secret. Leaving the password blank still prompts on each login.
- **End-to-end MCP integration tests** — a real `McpSocketServer` is started in-process and driven by the MCP SDK's `Client` over a Unix socket (named pipe on Windows), verifying the full proxy path: tool discovery, tool dispatch to the current session, graceful "no active session" errors, and live session-switch behavior without stale caching.
- **27 MCP tools (up from 16)** — eleven new tools: `add_dictionary`, `compile_class_definition`, `delete_class`, `delete_method`, `describe_class`, `export_class_source`, `find_references_to`, `list_all_classes`, `list_dictionary_entries`, `remove_dictionary`, `set_class_comment`. Write tools flag "NOT committed automatically"; destructive tools start descriptions with "DESTRUCTIVE:".
- **`describe_class` combined tool** — returns class definition, comment, and own methods grouped by category (both sides) in one round trip; descriptions guide agents to prefer it over calling `get_class_definition` + `list_methods` separately.
- **`getClassNames` and `getDictionaryEntries` accept dictionary name or index** — MCP clients can pass a dictionary name string; Jasper's IDE callers continue using 1-based indices.
- **Shadow-safe class lookup (`classLookupExpr`)** — shared helper composes Smalltalk that resolves a class either globally (`objectNamed:`) or scoped to a specific dictionary, for correct behavior when class names are shadowed across dictionaries. Used by `describe_class`, `export_class_source`, `compile_method`, `delete_method`, `set_class_comment`, and `fileOutClass`.
- **Optional `dictionaryName` parameter on class-targeting tools** — `describe_class`, `export_class_source`, `compile_method`, `delete_method`, and `set_class_comment` accept an optional dictionary name to disambiguate shadowed class names.

## [1.3.0] - 2026-04-10

### Added

- **MCP Server for Claude Code integration** — an embedded MCP (Model Context Protocol) server that lets Claude Code interact with GemStone directly, without the Topaz CLI; the MCP server runs as a separate Node.js process with its own GCI session (isolated from the user's sessions), using SSE/HTTP transport on an auto-assigned port; lifecycle is managed via Start/Stop buttons in the Databases pane, with the port automatically written to `.claude/settings.local.json`
- **16 MCP tools** — `abort`, `commit`, `compile_method`, `execute_code`, `find_implementors`, `find_senders`, `get_class_definition`, `get_class_hierarchy`, `get_method_source`, `list_classes`, `list_dictionaries`, `list_methods`, `run_test_class`, `run_test_method`, `search_method_source`, and `status`; together these give Claude a full development workflow: browse, write, test, commit/abort, and inspect session state
- **Login selection for MCP server** — starting the MCP server prompts for a login matching the database's stone name (auto-selects if only one exists); the MCP server logs in with its own credentials, keeping full isolation from user sessions
- **Open MCP Inspector** — a button on a running MCP Server node opens the standard MCP Inspector (`@modelcontextprotocol/inspector`) in a VS Code terminal, pre-configured with the server's URL; the terminal is tracked and disposed on stop or re-open to prevent port conflicts
- **Auto-stop MCP server on stone shutdown** — stopping a stone automatically stops any running MCP server for that stone first, preventing orphaned sessions

## [1.2.3] - 2026-04-10

### Fixed

- **Parser support for `@envN:` on all message kinds** — the language server parser now correctly handles the optional `@envN:` environment specifier prefix on unary, binary, and keyword messages, including nested messages inside binary/keyword arguments and all three cascade message kinds; previously, expressions such as `Transcript @env0:show: 2 @env1:+ 3 @env2:squared` were silently dropped or had the env specifier consumed as the selector

## [1.2.2] - 2026-04-05

### Added

- **Quick Setup wizard** — one-click "Quick Setup" command that checks shared memory, downloads and extracts a GemStone version, creates a database, starts Stone and NetLDI, and creates a login — getting a new user from zero to a running environment in a single step; if shared memory is not configured, offers to run the setup script and resumes automatically when the terminal closes
- **Execution busy-state indicators** — executing code (Execute It, Display It, Inspect It) now provides layered visual feedback: the selected code dims to 40% opacity while running, a `$(sync~spin) GemStone: Executing…` spinner appears in the status bar, and the execute/display/inspect commands are disabled (greyed out in context menus, keybindings ignored) until the execution completes; all indicators clear automatically on completion or error
- **Workspace document on login** — logging in now automatically opens a "Workspace" scratch pad (`gemstone://{sessionId}/Workspace`) with a sample expression; edits are preserved in memory for the session; the document is not reopened if already open

### Changed

- **Keybindings moved to `Cmd+;` chord prefix** — all keybindings now use a two-key chord (`Cmd+; D`, `Cmd+; E`, `Cmd+; I`, `Cmd+; B`, `Cmd+; C`, `Cmd+; M`) to avoid conflicts with core VS Code shortcuts (`Cmd+D`, `Cmd+E`, `Cmd+I`) and Copilot (`Cmd+I`); `Shift` modifier removed from browser, class, and method bindings
- **Shared memory threshold lowered to 1 GB** — shared memory checks now apply settings immediately and use a 1 GB threshold instead of 4 GB
- **No breadcrumbs for Workspace documents** — Workspace (doIt) documents no longer show a misleading `_doIt` breadcrumb; document symbols are suppressed for code-only regions since they have no navigational structure

## [1.2.1] - 2026-03-26

### Added

- **Find Class command** (`Cmd+; C` / `Ctrl+; C`) — quick-pick search across all classes in all dictionaries; selecting a class navigates the System Browser to it (or opens the class definition if no browser is open)
- **Find Method command** (`Cmd+; M` / `Ctrl+; M`) — quick-pick search across all methods (instance and class side) of the currently selected class in the System Browser; if no class is selected, prompts for a class name; selecting a method navigates the browser and opens the method editor
- **FileSystem provider logging** — `gemstone://` file operations (`stat`, `readFile`, `writeFile`) now log to the GemStone output channel, making it easier to diagnose save/compile issues; entries show the URI, read-only status, and success/failure of each operation
- **Register local GemStone versions** — "Register Local Version…" button in the Versions view lets you point to an existing GemStone installation directory without downloading or extracting; registered versions appear alongside downloaded ones and can be used for databases and logins; "Unregister" removes the registration without deleting files
- **Login editor version picker** — the login editor now shows a dropdown of available GemStone versions (from extracted installations and configured GCI library paths) instead of a free-text field

### Changed

- **Selecting a class no longer opens the `.gs` file** — the class definition and method navigation are available from the browser; the file can still be opened from the file explorer if needed
- **Method category context menu simplified** — removed "New Method" from the method category context menu (it remains in the method list context menu where the new method will appear); the context menu now only shows "Rename Category" for real categories and no menu for virtual entries
- **Find Class/Method navigate only the active browser** — when multiple System Browser panels are open for the same session, Find Class, Find Method, and Implementors/Senders now navigate only the most recently focused browser instead of all of them
- **Pool Dictionaries dropdown expanded** — the Class Definition panel's Pool Dictionaries dropdown now shows all `SymbolDictionary` instances visible in the user's symbol list (not just the top-level dictionary names), so pool dictionaries stored inside other dictionaries are discoverable
- **Debugger opens methods in the bottom editor group** — clicking a stack frame in the debugger now opens the method source via a `gemstone://` URI (the same path the System Browser uses), so it appears in the bottom editor group alongside other method editors instead of the top half
- **Breadcrumbs no longer duplicate class and method names** — document symbols for `gemstone://` method editors now use just the selector as the symbol name instead of `ClassName >> selector`, since the class and method are already shown in the URI path breadcrumbs

### Fixed

- **Browser refresh preserves full selection state** — commit and abort now restore the selected class, instance/class side toggle, method category, and method list after refresh; previously only the dictionary and class category were restored
- **Method list refreshes after compile or delete** — saving a new or existing method now immediately updates the method categories and method list in the System Browser; previously the list was stale until a manual refresh or commit/abort
- **Method category defaults to "as yet unclassified"** — selecting a method or creating a new method when "** ALL METHODS **" (or no category) is selected now uses `as yet unclassified` as the category instead of the literal virtual-category name; previously saving in this state created a duplicate `** ALL METHODS **` category entry
- **New Method template opens in the bottom editor group** — "New Method" from the method list context menu now opens in the same bottom panel as other method editors instead of the top half

- **Single-quote handling in Execute It / Display It** — code containing Smalltalk string literals (e.g. `UserGlobals at: #'James' put: 'Foster'.`) no longer produces a syntax error; the wrapper had been incorrectly doubling single quotes as if embedding in a string literal, but the user code is placed directly in Smalltalk source
- **Inline diagnostics for syntax errors** — compilation and runtime errors from Execute It / Display It / Inspect It now appear as red squiggly underlines in the editor (visible in the Problems panel) instead of only as notification popups; when the GemStone compiler reports a character offset, the diagnostic highlights the specific error location; diagnostics clear automatically on the next successful execution or document edit

## [1.2.0] - 2026-03-16

### Added

- **Globals Browser** — selecting a dictionary in the System Browser opens a sortable "Globals" tab (below the browser) showing all non-class globals in that dictionary with Name, Class, and Value columns; double-clicking a row opens the global in the Inspector (or selects it if already present)
- **Class Browser** — selecting a dictionary or class in the System Browser opens a "Class Definition" tab for creating, viewing, and editing class definitions; identity row (superclass dictionary, superclass, subclass name, in dictionary, category) across the top; variable lists (instance, class, class instance, pool dictionaries) side-by-side below; options grid with hint tooltips explaining each GemStone class option; new classes default superclass to `Globals >> Object`
- **Windows support (WSL)** — system administration features (versions, databases, processes) now work on Windows by bridging commands through WSL2; auto-detects WSL availability and shows setup guidance when not installed
- **WSL bridge module** — path conversion between Windows UNC and WSL Linux paths, command spawning and synchronous execution routed through `wsl.exe`
- **Browser-driven method editing** — clicking a method in the System Browser opens it in a dedicated editor tab (via `gemstone://` URI scheme) showing only that method's source; saving the tab compiles the method in GemStone via GCI; compile errors appear as VS Code diagnostics (red squiggles) without a modal popup
- **Write-access check** — `gemstone://` editor tabs are marked read-only when the class cannot be written by the current user (`canBeWritten` is queried via GCI); new-class and new-method tabs are always writable
- **Implementors/Senders navigate the Browser** — selecting a result from "Implementors of" or "Senders of" now navigates the System Browser's five columns to the chosen method in addition to opening the method editor tab; the browser panel is revealed without stealing focus from the editor
- **Preview tabs for method editors** — method editor tabs open in VS Code preview mode (italic title) so navigating from method to method reuses the same tab; the tab becomes permanent once edited

### Changed

- **Editor layout set by System Browser** — the top/bottom split layout is now applied by the System Browser when selecting a dictionary, ensuring panels appear in the correct order; previously set by the Globals Browser
- **Removed `** GLOBALS **` category** — the System Browser's Class Categories column no longer shows a special `** GLOBALS **` entry; globals are now accessible via the dedicated Globals Browser tab
- **All exported `.gs` files are read-only** — exported files are for search and navigation only; all editing happens through the System Browser's method editor tabs; file permissions are set to 0o444 after export regardless of dictionary or user
- **`FileInManager` simplified** — removed save-interception machinery (`onWillSaveTextDocument`, content cache, differential compilation); file create/delete event handling is retained
- **Commit/abort closes method editor tabs** — open `gemstone://` method editor tabs are closed when a session commits or aborts (stale after re-export); `hasUnsavedChanges` now also checks for dirty `gemstone://` docs so commit/abort warns correctly
- Renamed extension to "Jasper: A GemStone Smalltalk IDE"
- **Auto-generated login labels** — login labels are now derived from `{user} on {stone} ({host})` instead of being manually entered; removed the label text field from the login editor
- **Simplified export paths** — removed per-login `exportPath` field; export path is now controlled solely by the global `gemstone.exportPath` setting with a new `{session}` variable; default changed from `{workspaceRoot}/gemstone/{host}/{stone}/{user}/...` to `{workspaceRoot}/gemstone/{session}/...`
- **Duplicate login** now opens the login editor (pre-filled) instead of silently creating a copy
- **Multi-session safety** — prevents multiple simultaneous logins when custom `exportPath` does not include `{session}`, avoiding file conflicts
- Reordered inline buttons: logins show delete/duplicate/login (left-to-right); sessions show logout/abort/commit
- Added icons to SysAdmin tree views (Configure OS, Versions, Databases, Processes)
- Updated repository URLs from `vscode-gemstone` to `Jasper`
- Renamed "GemStone Smalltalk Formatter" settings section to "Smalltalk Formatter"

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
