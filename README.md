# Jasper — A Visual Studio Code Extension for a GemStone Smalltalk IDE

A full-featured GemStone/S 64 Bit development environment for Visual Studio Code. Write, browse, debug, and test GemStone Smalltalk code — and manage your GemStone infrastructure — all from a single editor.

Jasper works on **macOS**, **Linux**, and **Windows**:

| Platform | Server management | Client IDE (connect to remote GemStone) |
|----------|-------------------|-----------------------------------------|
| macOS    | Yes               | Yes                                     |
| Linux    | Yes               | Yes                                     |
| Windows (with WSL) | Yes (via WSL) | Yes                              |
| Windows (no WSL)   | No            | Yes                              |

## Getting Started

### Connecting to an existing GemStone server (any platform)

If you already have a GemStone server running on another machine (or locally), you only need a login configuration and the native GCI client library for your version of GemStone.

1. Install the extension from the VS Code Marketplace.
2. Open the **GemStone** sidebar (gem icon in the activity bar).
3. Click the **+** button in the **Logins** section to create a new login.
4. Fill in the connection details: GemStone version, host, stone name, NetLDI, and credentials.
5. Click **Login** to connect.

The first time you log in with a given GemStone version, Jasper needs the native GCI library (`libgcits`) for that version:

- **On Windows**, Jasper will offer to **download the Windows client distribution** automatically. This downloads and extracts the library — no WSL or manual setup required.
- **On macOS/Linux**, the library is included in the GemStone server distribution. If you have a local installation, Jasper auto-detects it. Otherwise, use the **Versions** section to download the distribution for your platform, or point Jasper to an existing library path via the `gemstone.gciLibraries` setting.

### Full local setup (macOS, Linux, or Windows with WSL)

To install, manage, and run a GemStone server locally:

1. Install the extension from the VS Code Marketplace.
2. Open the **GemStone** sidebar (gem icon in the activity bar).
3. Check the **OS Configuration** section: on macOS/Linux run the shared-memory setup if it warns; on Windows+WSL Jasper also surfaces WSL networking and services-file configuration here.
4. Use the **Versions** section to download and extract a GemStone release.
5. Use the **Databases** section to create a new database.
6. Start the stone and NetLDI from the database tree.
7. Click **Create Login** on the database to generate a login configuration.
8. Click **Login** to connect and start developing.

Alternatively, run **Quick Setup** (button in the Versions view) to do all of the above in one step.

## Windows Usage

Jasper supports two Windows configurations:

### Windows without WSL — Client IDE only

Connect to a GemStone server running on a remote host (or in a VM). No WSL installation is required.

1. Create a login with the remote host, stone name, and NetLDI.
2. On first login, Jasper offers to download the **Windows client distribution** for your GemStone version. This is a small download (~15 MB) containing only the native GCI DLL.
3. After the download, Jasper auto-detects the library and connects.

You can also download client libraries ahead of time using the **Download Windows Client** button in the **Versions** view.

The Versions, Databases, and Processes sections are hidden when WSL is not available, since server management requires a Linux environment.

### Windows with WSL — Full server management

With WSL installed and a Linux distribution configured, Jasper can manage GemStone servers running inside WSL while the VS Code extension runs natively on Windows. The GemStone server distribution is downloaded and extracted inside WSL, while the Windows client distribution provides the native DLL for VS Code to communicate with the server.

#### Reaching WSL from Windows

The Windows extension connects to GemStone services (NetLDI) that run inside WSL, so a GemStone login needs a host and a port that Windows can route to. There are three paths, presented in the **OS Configuration** view under **WSL networking**:

1. **Mirrored networking (recommended, Windows 11 22H2 + WSL core 2.0+)** — `localhost` on Windows reaches services bound inside WSL with no further setup. Jasper detects the state and, when NAT is active, offers a one-click **Enable mirrored networking** action that writes `networkingMode=mirrored` to `%USERPROFILE%\.wslconfig` and prompts to restart WSL.
2. **Stable name via hosts file (Windows 10 fallback)** — Jasper can write `<wsl-ip> wsl-linux` to `C:\Windows\System32\drivers\etc\hosts`. Logins then use `wsl-linux` instead of a raw IP. Because WSL2 assigns a new IP after `wsl --shutdown` or reboot, the action is idempotent and meant to be re-run after any WSL restart. The script self-elevates via UAC.
3. **Copy the IP** — running NetLDI items expose a **Copy Host** context action. Under mirrored networking this copies `localhost`; otherwise it copies the current WSL IP (shown in the item's tooltip). Paste into the login's Host field.

#### NetLDI port naming (`gs64ldi`)

Jasper also detects whether `gs64ldi 50377/tcp` is present in `/etc/services` on both sides. With the entry in place, `startnetldi` binds to the conventional port 50377 (instead of picking a random one) and logins can name the port as `gs64ldi`. The **Services** row under OS Configuration offers separate write actions for the Windows and WSL sides — the Windows write needs admin (UAC), the WSL write needs `sudo`.

## Infrastructure Management

Manage your GemStone installation directly from VS Code (macOS, Linux, or Windows with WSL).

### OS Configuration

The **OS Configuration** view surfaces every host-level setting GemStone needs, with one-click actions where possible:

- **Shared memory** — checks `sysctl` on macOS, Linux, and WSL, and warns if `shmmax`/`shmall` are below 1 GB. The setup script applies the change immediately and persists it (a `LaunchDaemon` plist on macOS, `/etc/sysctl.d/60-gemstone.conf` on Linux/WSL).
- **RemoveIPC (Linux/WSL)** — verifies that `/etc/systemd/logind.conf` sets `RemoveIPC=no`, so logging out of the session that started the stone doesn't destroy its shared memory segment.
- **WSL networking (Windows only)** — mirrored vs. NAT detection with an action to enable mirrored mode (see _Reaching WSL from Windows_ above).
- **Services (Windows only)** — detects the `gs64ldi 50377/tcp` entry on both sides and offers write actions.
- **WSL distro version (Windows only)** — warns if the default distro is on WSL 1 and provides an **Upgrade to WSL 2** action.

### Version Management

The **Versions** view lists GemStone releases available for your platform (macOS ARM, macOS x86, Linux x86). For each version you can:

- **Download** the release archive from GemTalk Systems
- **Extract** the archive (automatic DMG mounting on macOS, unzip on Linux)
- **Open** the extracted directory in Finder/Explorer
- **Delete** the download or extracted files

On Windows, the **Download Windows Client** button fetches the native client distribution for connecting to remote GemStone servers.

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
| Display It | Cmd+; D | Ctrl+; D | Evaluate selection and insert result inline |
| Execute It | Cmd+; E | Ctrl+; E | Evaluate selection silently |
| Inspect It | Cmd+; I | Ctrl+; I | Evaluate selection and show result in Inspector |

Long-running expressions show a progress notification with soft-break and hard-break options. The **GemStone Transcript** output channel captures transcript output from the session.

### System Browser

Open with **Cmd+; B** (Ctrl+; B) or from a session's inline button. The browser provides a five-column layout:

- **Dictionaries** — your symbol list dictionaries
- **Class Categories** — classes grouped by category
- **Classes** — class list with hierarchy toggle
- **Method Categories** — method categories with `** ALL METHODS **`
- **Methods** — method selectors

Click a method to view and edit its source. **Cmd+S** (Ctrl+S) compiles changes back to GemStone. Class definitions and comments are also editable.

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
- **Go to Definition** (Cmd+Click / Ctrl+Click / F12) — jump to implementors of a selector or a class definition

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

## Claude / MCP Integration

Jasper exposes its GemStone tools to MCP-aware AI clients (Claude Code, Claude Desktop, MCP Inspector). All tools run against the user's **currently active session** — there are no separate credentials, no per-database subprocesses, and no off-host exposure.

Two transports are served in parallel:

| Transport | Endpoint | Used by |
|-----------|----------|---------|
| stdio (proxy) | local socket / named pipe | Claude Code (via `claude mcp add`) |
| HTTPS/SSE | `https://127.0.0.1:27101/sse` | Claude Desktop "Add custom connector", MCP Inspector, any URL-based MCP client |

### Claude Code

Registered automatically on extension activation by invoking `claude mcp add gemstone -- node <proxy> --proxy-socket <path>` in the workspace folder. The CLI writes the entry into `~/.claude.json`'s per-project scope. If the `claude` CLI isn't on PATH the registration is skipped silently.

### Claude Desktop

Jasper writes a per-workspace `gemstone-<hash>` entry into Claude Desktop's global `claude_desktop_config.json` on activation and removes it on deactivation. Disable with `gemstone.mcp.registerWithClaudeDesktop: false` in your settings.

To use the HTTPS/SSE surface from Claude Desktop's "Add custom connector" dialog you must first trust the self-signed certificate Jasper generates on first run:

1. Run **`GemStone: Install MCP TLS Certificate`** from the Command Palette.
2. Choose **Run in Terminal** (macOS will prompt for an admin password) or copy the command and run it yourself.
3. Run **`GemStone: Copy MCP Server URL`** and paste it into the connector dialog.

The cert is valid for `127.0.0.1` and `localhost` only, lives in the extension's global storage directory, and is shared across workspaces — you only have to trust it once.

### MCP Inspector

Run **`GemStone: Open MCP Inspector`** from the Command Palette. The terminal it spawns picks up `NODE_EXTRA_CA_CERTS` pointing at Jasper's cert so Node's TLS stack accepts the connection (OS keychain trust does not apply to Node).

### Multiple VS Code windows

The HTTPS port is global, so the first window to activate wins. Subsequent windows log an `EADDRINUSE` note to **GemStone Admin** and skip the HTTPS surface (Claude Code's stdio surface still works in every window). To run two windows simultaneously, override `gemstone.mcp.httpPort` in each workspace's `.vscode/settings.json`.

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
| `gemstone.mcp.httpPort` | 27101 | Port on 127.0.0.1 where Jasper serves the MCP HTTPS/SSE surface |
| `gemstone.mcp.registerWithClaudeDesktop` | true | Auto-register the gemstone MCP server in Claude Desktop's global config |

> **Tip:** VS Code's Quick Open file search (Cmd+P / Ctrl+P) and the title bar search respect `.gitignore` by default, so exported `.gs` files in gitignored directories won't appear in search results. To include them, set `"search.useIgnoreFiles": false` in your VS Code settings. If there are some ignored things you want to continue to exclude, you can tell VS Code to exclude certain paths with the `files.exclude` setting.

## GCI Library

The extension communicates with GemStone databases using the GemStone C Interface (GCI) thread-safe library (`libgcits`), loaded at runtime via [koffi](https://koffi.dev/). The library path is resolved in this order:

1. **Auto-detected** from extracted distributions (server or Windows client) matching the login's GemStone version
2. **Configured** per-version in the `gemstone.gciLibraries` setting
3. **Prompted** — on Windows you are offered an automatic download; on all platforms you can browse to the library manually

The Windows client distribution exports a subset of the full GCI interface — non-blocking login and debug-attach functions are not available, but all standard session operations work normally.

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
