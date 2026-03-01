# GemStone Smalltalk IDE

A full-featured GemStone/S 64 Bit development environment for Visual Studio Code. Write, browse, debug, and test GemStone Smalltalk code — and manage your GemStone infrastructure — all from a single editor.

## Getting Started

1. Install the extension from the VS Code Marketplace.
2. Open the **GemStone** sidebar (gem icon in the activity bar).
3. If on macOS, check the **Shared Memory** section and run the setup script if needed (requires restart).
4. Use the **Versions** section to download and extract a GemStone release.
5. Use the **Databases** section to create a new database.
6. Start the stone and NetLDI from the database tree.
7. Click **Create Login** on the database to generate a login configuration.
8. Click **Login** to connect and start developing.

## Infrastructure Management

Manage your GemStone installation directly from VS Code, no separate tools required.

### Shared Memory (macOS)

GemStone requires shared memory on macOS. The **Shared Memory** view checks your current `sysctl` settings and shows whether they are configured. If not, click **Run setup script** to install a `LaunchDaemon` plist that sets the values at boot, then restart your computer.

### Version Management

The **Versions** view lists GemStone releases available for your platform (macOS ARM, macOS x86, Linux x86). For each version you can:

- **Download** the release archive from GemTalk Systems
- **Extract** the archive (automatic DMG mounting on macOS, unzip on Linux)
- **Open** the extracted directory in Finder/Explorer
- **Delete** the download or extracted files

### Database Management

The **Databases** view shows all databases under your GemStone root directory (configurable via `gemstone.rootPath`, default `~/Documents/GemStone`). Click the **+** button to create a new database with a multi-step wizard:

1. Select a GemStone version (from extracted versions)
2. Select a base extent
3. Enter a stone name
4. Enter a NetLDI name

The extension creates the full directory structure (`conf/`, `data/`, `log/`, `stat/`), writes configuration files (`system.conf`, `gem.conf`, stone config), copies the key file and base extent, and writes `database.yaml`.

Each database node expands to show:

- **Stone** — running/stopped status with start/stop buttons
- **NetLDI** — running/stopped status with port number and start/stop buttons
- **Logs** — expandable list of log files (click to open in editor)
- **Config** — expandable list of configuration files (click to open in editor)

Inline buttons on each database provide:

- **Reveal in Finder** — open the database directory
- **Open Terminal** — launch a terminal with all GemStone environment variables pre-configured
- **Create Login** — generate a login pre-filled with the database's connection details
- **Replace Extent** — replace the stopped stone's extent with a fresh base extent (deletes old extent and transaction logs)
- **Delete** — remove the database directory (requires stone and NetLDI to be stopped)

### Process List

The **Processes** view shows all running GemStone processes (stones and NetLDIs) detected via `gslist`, including version, PID, and port information.

## IDE Features

### Logins

The **Logins** view stores connection configurations for your GemStone databases. Each login specifies:

- GemStone version and GCI library path
- Host, stone name, and NetLDI
- GemStone and host credentials
- Optional per-login export path template

Use the toolbar to add, edit, duplicate, or delete logins. Click **Login** to establish a session.

### Sessions

The **Sessions** view shows active GemStone connections. Each session provides inline buttons for:

- **Commit** / **Abort** — transaction control
- **Open Browser** — launch the System Browser for this session
- **Export** — export classes to local files
- **Logout** — disconnect

Click a session to make it the **active session** for code execution. The status bar shows which session is active.

### Code Execution

With an active session, execute Smalltalk code from any editor:

| Command | macOS | Windows/Linux | Description |
|---------|-------|---------------|-------------|
| Display It | Cmd+D | Ctrl+D | Evaluate selection and insert result inline |
| Execute It | Cmd+E | Ctrl+E | Evaluate selection silently |
| Inspect It | Cmd+I | Ctrl+I | Evaluate selection and show result in Inspector |

Long-running expressions show a progress notification with soft-break and hard-break options. The **GemStone Transcript** output channel captures transcript output from the session.

### System Browser

Open with **Cmd+Shift+B** (Ctrl+Shift+B) or from a session's inline button. The browser provides a five-column layout:

- **Dictionaries** — your symbol list dictionaries
- **Class Categories** — classes grouped by category
- **Classes** — class list with hierarchy toggle
- **Method Categories** — method categories with `** ALL METHODS **`
- **Methods** — method selectors

Click a method to view and edit its source. **Cmd+S** compiles changes back to GemStone. Class definitions and comments are also editable.

Context menu operations include:

- Add/delete/rename dictionaries, categories, classes, and methods
- Move classes between dictionaries, reclassify by category
- Drag-and-drop methods to recategorize
- Drag-and-drop classes between dictionaries
- Browse references, senders, implementors, and class hierarchy
- Run SUnit tests on a class

### Object Inspector

The **Inspector** sidebar view displays GemStone objects with drill-down into named and indexed instance variables. Pin objects via **Inspect It** or by clicking globals in the browser. Large collections are paginated.

### Search and Navigation

- **Senders Of** — find all methods sending a selector (editor context menu or browser)
- **Implementors Of** — find all implementations of a selector
- **Browse References** — find methods referencing a dictionary or class
- **Search Method Source** — full-text search across method source code
- **Class Hierarchy** — view superclass chain and subclasses
- **Workspace Symbol** (Cmd+T / Ctrl+T) — search classes and methods across both local files and the active GemStone session
- **Go to Definition** (Cmd+Click / F12) — jump to implementors of a selector or a class definition

### Debugging

When code execution hits an error, a **Debug** button opens the VS Code debugger with:

- Full stack trace with `ClassName >> #selector` frame names
- Click any frame to view its method source
- **Arguments & Temps** and **Receiver** variable scopes with drill-down
- Step Over, Step Into, Step Out, and Continue
- Restart Frame support
- Evaluate expressions in the Debug Console in any frame context

### Breakpoints

- **Line breakpoints** — click the editor gutter in a `gemstone://` method to set/clear breakpoints mapped to GemStone step points
- **Selector breakpoints** — right-click a selector and choose **Toggle Selector Breakpoint** to break whenever that selector is sent; breakpointed selectors are highlighted with a red border

### SUnit Test Runner

The extension integrates with VS Code's native Test Explorer:

- Auto-discovers all `TestCase` subclasses and their `test*` methods
- Run individual tests or entire test classes
- Pass/fail/error results with failure messages
- Test items link to method source

### File Export

Export classes from a GemStone session to local `.gs` files in Topaz format. Exported files are organized by host, stone, user, and dictionary (or use a custom per-login export path template). Editing an exported file and saving compiles it back into GemStone.

The `gemstone.userManagedDictionaries` setting lists dictionary names that the extension will never overwrite during export.

## Language Support

The extension provides language support for three GemStone file formats:

- **Topaz** (`.gs`, `.tpz`) — Topaz command language with 40+ commands (`run`, `doit`, `printit`, `method`, `classmethod`, etc.) and embedded Smalltalk
- **Tonel** (`.st`) — Rowan package manager format with STON metadata headers
- **Smalltalk** — bare Smalltalk for browser documents and scratch files

All formats include:

- Syntax highlighting (TextMate grammars)
- Semantic token highlighting (LSP)
- Hover documentation
- Autocompletion
- Go to Definition and Find References
- Document and workspace symbols
- Code formatting with configurable options
- Diagnostics
- Code folding

### Formatter Settings

Fine-tune the Smalltalk formatter under `gemstoneSmalltalk.formatter.*`:

| Setting | Default | Description |
|---------|---------|-------------|
| `spacesInsideParens` | false | `( x )` vs `(x)` |
| `spacesInsideBrackets` | false | `[ x ]` vs `[x]` |
| `spacesInsideBraces` | false | `{ x }` vs `{x}` |
| `spacesAroundAssignment` | true | `x := y` vs `x:=y` |
| `spacesAroundBinarySelectors` | true | `a + b` vs `a+b` |
| `spaceAfterCaret` | false | `^ x` vs `^x` |
| `blankLineAfterMethodPattern` | true | Blank line between pattern and body |
| `maxLineLength` | 0 | Line wrapping (0 = off) |
| `continuationIndent` | 2 | Indent for continuation lines |
| `multiKeywordThreshold` | 2 | Keywords before splitting across lines |
| `removeUnnecessaryParens` | true | Remove based on Smalltalk precedence |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `gemstone.rootPath` | `~/Documents/GemStone` | Root directory for GemStone installations and databases |
| `gemstone.gciLibraries` | `{}` | Map of GemStone versions to GCI library paths |
| `gemstone.exportPath` | `""` | Root path for class file export (supports `{workspaceRoot}`) |
| `gemstone.userManagedDictionaries` | `[]` | Dictionary names excluded from export |
| `gemstone.maxEnvironment` | 0 | Method environments to display in browser |

## GCI Library

The extension communicates with GemStone databases using the GemStone C Interface (GCI) thread-safe library (`libgcits`), loaded at runtime via [koffi](https://koffi.dev/). The library path is configured per-version in `gemstone.gciLibraries` or auto-detected when creating a login from a local database.

## Development

- Build: `npm run compile`
- Watch: `npm run watch`
- Test: `npm test`
- Test GCI: `GCI_LIBRARY_PATH=/path/to/libgcits npm run test:gci`
- Package: `npm run package`

### Publishing

1. Update the version in `package.json` and add a changelog entry.
2. Build and test: `npm run compile && npm test`
3. Package: `npx @vscode/vsce package`
4. Publish: `npx @vscode/vsce publish`

You must be logged in with a Personal Access Token for the `gemtalksystems` publisher. To set up credentials:

```sh
npx @vscode/vsce login gemtalksystems
```

## License

MIT
