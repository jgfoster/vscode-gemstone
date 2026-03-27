import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { LoginStorage } from './loginStorage';
import { LoginTreeProvider, GemStoneLoginItem } from './loginTreeProvider';
import { loginLabel } from './loginTypes';
import { LoginEditorPanel } from './loginEditorPanel';
import { SessionManager } from './sessionManager';
import { SessionTreeProvider, GemStoneSessionItem } from './sessionTreeProvider';
import { CodeExecutor } from './codeExecutor';
import { SystemBrowser } from './systemBrowser';
import { GlobalsBrowser } from './globalsBrowser';
import { ClassBrowser } from './classBrowser';
import { GemStoneFileSystemProvider } from './gemstoneFileSystemProvider';
import { GemStoneDebugSession } from './gemstoneDebugSession';
import { InspectorTreeProvider, InspectorNode } from './inspectorTreeProvider';
import { GemStoneWorkspaceSymbolProvider } from './gemstoneSymbolProvider';
import { GemStoneDefinitionProvider } from './gemstoneDefinitionProvider';
import { GemStoneHoverProvider } from './gemstoneHoverProvider';
import { GemStoneCompletionProvider } from './gemstoneCompletionProvider';
import { BreakpointManager } from './breakpointManager';
import { SelectorBreakpointManager } from './selectorBreakpointManager';
import { SunitTestController } from './sunitTestController';
import { ExportManager } from './exportManager';
import { FileInManager } from './fileInManager';
import { showTranscript } from './transcriptChannel';
import { GemStoneCodeLensProvider } from './gemstoneCodeLensProvider';
import * as queries from './browserQueries';
import { SysadminStorage } from './sysadminStorage';
import { appendSysadmin } from './sysadminChannel';
import { VersionManager } from './versionManager';
import { VersionTreeProvider, VersionItem } from './versionTreeProvider';
import { DatabaseManager } from './databaseManager';
import { DatabaseTreeProvider, DatabaseNode } from './databaseTreeProvider';
import { ProcessManager } from './processManager';
import { ProcessTreeProvider } from './processTreeProvider';
import { OsConfigTreeProvider } from './sharedMemoryTreeProvider';
import { isWindows, getWslInfo } from './wslBridge';

let client: LanguageClient;
let sessionManager: SessionManager;
let exportManager: ExportManager;
let fileInManager: FileInManager;

export function activate(context: vscode.ExtensionContext) {
  // ── LSP Client ───────────────────────────────────────────
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'gemstone-topaz' },
      { scheme: 'file', language: 'gemstone-tonel' },
      { scheme: 'gemstone', language: 'gemstone-smalltalk' },
    ],
    synchronize: {
      configurationSection: 'gemstoneSmalltalk',
    },
  };

  client = new LanguageClient(
    'gemstone-smalltalk',
    'GemStone Smalltalk Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  // ── Login Management ─────────────────────────────────────
  const storage = new LoginStorage();
  const sysadminStorage = new SysadminStorage();
  const treeProvider = new LoginTreeProvider(storage);

  const treeView = vscode.window.createTreeView('gemstoneLogins', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gemstone.logins')) {
        treeProvider.refresh();
      }
      if (e.affectsConfiguration('gemstone.maxEnvironment')) {
        // maxEnvironment changes are picked up on next browser refresh
      }
    })
  );

  // ── Session Management ───────────────────────────────────
  sessionManager = new SessionManager();
  exportManager = new ExportManager();
  fileInManager = new FileInManager(sessionManager, exportManager);
  fileInManager.register(context);
  const sessionTreeProvider = new SessionTreeProvider(sessionManager);

  const sessionTreeView = vscode.window.createTreeView('gemstoneSessions', {
    treeDataProvider: sessionTreeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(sessionTreeView);

  // ── Object Inspector ──────────────────────────────────────
  const inspectorProvider = new InspectorTreeProvider(sessionManager);

  const inspectorView = vscode.window.createTreeView('gemstoneInspector', {
    treeDataProvider: inspectorProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(inspectorView);

  // ── GemStone FileSystem Provider ─────────────────────────
  const gemstoneFs = new GemStoneFileSystemProvider(sessionManager);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('gemstone', gemstoneFs, {
      isCaseSensitive: true,
    })
  );

  // ── Workspace Symbol Provider (Cmd+T class search) ──────
  const symbolProvider = new GemStoneWorkspaceSymbolProvider(sessionManager);
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(symbolProvider),
  );

  // Set language mode for gemstone:// documents
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === 'gemstone') {
        vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
      }
    })
  );

  // Lock editors for read-only .gs files (e.g. Globals for non-SystemUser)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const { uri } = editor.document;
      if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.gs')) return;
      try {
        const stat = fs.statSync(uri.fsPath);
        if ((stat.mode & 0o200) === 0) {
          vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
        }
      } catch { /* ignore */ }
    })
  );

  // ── GCI-backed providers (Definition + Hover + Completion) ─
  const providerSelectors: vscode.DocumentFilter[] = [
    { scheme: 'gemstone', language: 'gemstone-smalltalk' },
    { scheme: 'file', language: 'gemstone-topaz' },
    { scheme: 'file', language: 'gemstone-tonel' },
  ];
  const selectorResolver = {
    getSelector: (uri: string, position: vscode.Position) =>
      client.sendRequest<string | null>('gemstone/selectorAtPosition', {
        textDocument: { uri },
        position,
      }),
  };
  const definitionProvider = new GemStoneDefinitionProvider(sessionManager, selectorResolver);
  const hoverProvider = new GemStoneHoverProvider(sessionManager, selectorResolver);
  const completionProvider = new GemStoneCompletionProvider(sessionManager);
  const codeLensProvider = new GemStoneCodeLensProvider(sessionManager);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(providerSelectors, definitionProvider),
    vscode.languages.registerHoverProvider(providerSelectors, hoverProvider),
    vscode.languages.registerCompletionItemProvider(providerSelectors, completionProvider),
    vscode.languages.registerCodeLensProvider(providerSelectors, codeLensProvider),
  );

  // ── Breakpoints + Debugger ───────────────────────────────
  const breakpointManager = new BreakpointManager(sessionManager);
  breakpointManager.register(context);

  const selectorBreakpointManager = new SelectorBreakpointManager(sessionManager);
  selectorBreakpointManager.register(context);

  // Re-apply breakpoints and refresh browser method list after method recompilation
  context.subscriptions.push(
    gemstoneFs.onDidChangeFile(events => {
      for (const event of events) {
        if (event.type === vscode.FileChangeType.Changed) {
          breakpointManager.invalidateForUri(event.uri);
          selectorBreakpointManager.invalidateForUri(event.uri);

          const uri = event.uri;
          if (uri.scheme === 'gemstone') {
            const parts = uri.path.split('/').map(decodeURIComponent);
            // parts: ['', dictName, className, side, category, selector]
            if (parts.length >= 3) {
              const sessionId = parseInt(uri.authority, 10);
              const className = parts[2];
              SystemBrowser.methodCompiled(sessionId, className);
            }
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('gemstone', {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterInlineImplementation(
          new GemStoneDebugSession(sessionManager, breakpointManager),
        );
      },
    }),
    vscode.debug.registerDebugConfigurationProvider('gemstone', {
      resolveDebugConfiguration(_folder, config) {
        if (!config.type) config.type = 'gemstone';
        if (!config.request) config.request = 'attach';
        if (!config.name) config.name = 'GemStone Debug';
        return config;
      },
    }),
  );

  // ── SUnit Test Controller ────────────────────────────────
  const sunitTestController = new SunitTestController(sessionManager);
  context.subscriptions.push(sunitTestController);

  // ── Code Execution ─────────────────────────────────────
  const codeExecutor = new CodeExecutor(sessionManager);
  context.subscriptions.push(codeExecutor);

  // ── Status Bar: Active Session ─────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100
  );
  statusBarItem.command = 'gemstone.selectSession';
  context.subscriptions.push(statusBarItem);

  const browserBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 99
  );
  browserBarItem.text = '$(book)';
  browserBarItem.tooltip = 'Open System Browser';
  browserBarItem.command = 'gemstone.openBrowser';
  context.subscriptions.push(browserBarItem);

  function updateStatusBar() {
    const session = sessionManager.getSelectedSession();
    if (session) {
      statusBarItem.text = `$(database) ${loginLabel(session.login)}`;
      statusBarItem.tooltip = 'GemStone: click to change session';
      statusBarItem.show();
      browserBarItem.show();
    } else if (sessionManager.getSessions().length > 0) {
      statusBarItem.text = '$(database) No session selected';
      statusBarItem.tooltip = 'Click to select a GemStone session';
      statusBarItem.show();
      browserBarItem.hide();
    } else {
      statusBarItem.hide();
      browserBarItem.hide();
    }
  }

  context.subscriptions.push(
    sessionManager.onDidChangeSelection(() => updateStatusBar())
  );
  updateStatusBar();

  // ── Shared Helpers ─────────────────────────────────────

  async function resolveSelector(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (!editor.selection.isEmpty) {
        return editor.document.getText(editor.selection).trim();
      }
      // Ask LSP for selector at cursor position
      if (client) {
        try {
          const selector = await client.sendRequest<string | null>(
            'gemstone/selectorAtPosition',
            {
              textDocument: { uri: editor.document.uri.toString() },
              position: editor.selection.active,
            },
          );
          if (selector) return selector;
        } catch {
          // LSP not ready or request not supported
        }
      }
    }

    return vscode.window.showInputBox({
      prompt: 'Enter selector',
      placeHolder: 'e.g. at:put:',
    });
  }

  async function showMethodResults(
    session: { id: number },
    results: queries.MethodSearchResult[],
    title: string,
  ): Promise<void> {
    if (results.length === 0) {
      vscode.window.showInformationMessage(`${title}: no results found.`);
      return;
    }

    const items = results.map(r => ({
      label: `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
      description: r.category,
      detail: r.dictName,
      result: r,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} method${results.length === 1 ? '' : 's'} found`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;

    const r = picked.result;
    // If a System Browser is open for this session, navigate it to the selected
    // method (updates all 5 columns) and open the method editor from there.
    // Otherwise fall back to opening the document directly.
    if (!SystemBrowser.navigateTo(session.id, r)) {
      const side = r.isMeta ? 'class' : 'instance';
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
        `/${encodeURIComponent(r.dictName)}` +
        `/${encodeURIComponent(r.className)}` +
        `/${side}` +
        `/${encodeURIComponent(r.category)}` +
        `/${encodeURIComponent(r.selector)}`
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }
  }

  // ── Commands ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.openDocument', async (uri: vscode.Uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('gemstone.addLogin', () => {
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.editLogin', (item: GemStoneLoginItem) => {
      LoginEditorPanel.show(storage, treeProvider, item.login, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.deleteLogin', async (item: GemStoneLoginItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete login "${loginLabel(item.login)}"?`,
        { modal: true },
        'Delete',
      );
      if (confirmed === 'Delete') {
        await storage.deleteLogin(loginLabel(item.login));
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('gemstone.duplicateLogin', (item: GemStoneLoginItem) => {
      const copy = { ...item.login, label: '' };
      LoginEditorPanel.show(storage, treeProvider, copy, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.login', async (item: GemStoneLoginItem) => {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showErrorMessage(
          'Please open a folder in the workspace before logging in to GemStone.',
        );
        return;
      }

      const login = { ...item.login };

      if (!login.gs_password) {
        const password = await vscode.window.showInputBox({
          prompt: `GemStone password for ${login.gs_user || 'user'}@${login.gem_host || 'host'}`,
          password: true,
        });
        if (password === undefined) return;
        login.gs_password = password;
      }

      if (!login.host_password && login.host_user) {
        const password = await vscode.window.showInputBox({
          prompt: `Host password for ${login.host_user}@${login.gem_host || 'host'}`,
          password: true,
        });
        if (password === undefined) return;
        login.host_password = password;
      }

      // Ensure GCI library is configured for this version
      let gciPath = storage.getGciLibraryPath(login.version);

      // Auto-detect from extracted version's lib/ directory
      if (!gciPath) {
        const gsPath = sysadminStorage.getGemstonePath(login.version);
        if (gsPath) {
          const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
          const candidate = path.join(gsPath, 'lib', `libgcits-${login.version}-64.${ext}`);
          if (fs.existsSync(candidate)) {
            gciPath = candidate;
          }
        }
      }

      if (!gciPath) {
        const filters: Record<string, string[]> =
          process.platform === 'win32'
            ? { 'DLL files': ['dll'] }
            : process.platform === 'darwin'
              ? { 'Dynamic libraries': ['dylib'] }
              : { 'Shared libraries': ['so'] };

        const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
        const expectedName = `libgcits-${login.version}-64.${ext}`;

        const result = await vscode.window.showOpenDialog({
          title: `Select GCI library (${expectedName}) for GemStone ${login.version}`,
          canSelectMany: false,
          filters,
        });
        if (!result || result.length === 0) return;
        gciPath = result[0].fsPath;

        const selectedName = gciPath.split(/[\\/]/).pop();
        const libPattern = /^libgcits-[\d.]+.*-64\.\w+$/;
        if (!libPattern.test(selectedName || '')) {
          const pick = await vscode.window.showWarningMessage(
            `Selected file "${selectedName}" does not match expected pattern "${expectedName}". Use it anyway?`,
            'Yes', 'No',
          );
          if (pick !== 'Yes') return;
        }
        await storage.setGciLibraryPath(login.version, gciPath);
      }

      // The in-process GCI library reads GEMSTONE_GLOBAL_DIR to find the
      // NetLDI lock file (which encodes the port it is listening on).
      // Set both variables from sysadminStorage so the login can succeed
      // even though the VSCode/Electron process doesn't inherit them.
      process.env.GEMSTONE_GLOBAL_DIR = sysadminStorage.getRootPath();
      const gsInstallPath = sysadminStorage.getGemstonePath(login.version)
        ?? path.dirname(path.dirname(gciPath));
      process.env.GEMSTONE = gsInstallPath;

      try {
        const session = sessionManager.login(login, gciPath);
        sessionTreeProvider.refresh();
        vscode.window.showInformationMessage(
          `Connected to ${login.stone} (${session.stoneVersion}) on ${login.gem_host} as ${login.gs_user}`
        );
        exportManager.exportSession(session, true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Login failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.sessionCommit', async (item: GemStoneSessionItem) => {
      if (fileInManager.hasUnsavedChanges(item.activeSession)) {
        const choice = await vscode.window.showWarningMessage(
          'Exported .gs files have unsaved edits that will be overwritten.',
          { modal: true },
          'Commit Anyway',
        );
        if (choice !== 'Commit Anyway') return;
      }
      try {
        const { success, err } = sessionManager.commit(item.activeSession.id);
        if (success) {
          vscode.window.showInformationMessage(
            `Session ${item.activeSession.id}: Commit succeeded.`
          );
          gemstoneFs.closeTabsForSession(item.activeSession.id);
          await exportManager.refreshSession(item.activeSession);
          SystemBrowser.refresh(item.activeSession.id);
        } else {
          vscode.window.showErrorMessage(
            `Session ${item.activeSession.id}: Commit failed — ${err.message || `error ${err.number}`}`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Commit failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.sessionAbort', async (item: GemStoneSessionItem) => {
      if (fileInManager.hasUnsavedChanges(item.activeSession)) {
        const choice = await vscode.window.showWarningMessage(
          'Exported .gs files have unsaved edits that will be overwritten.',
          { modal: true },
          'Abort Anyway',
        );
        if (choice !== 'Abort Anyway') return;
      }
      try {
        const { success, err } = sessionManager.abort(item.activeSession.id);
        if (success) {
          vscode.window.showInformationMessage(
            `Session ${item.activeSession.id}: Abort succeeded.`
          );
          gemstoneFs.closeTabsForSession(item.activeSession.id);
          await exportManager.refreshSession(item.activeSession);
          SystemBrowser.refresh(item.activeSession.id);
        } else {
          vscode.window.showErrorMessage(
            `Session ${item.activeSession.id}: Abort failed — ${err.message || `error ${err.number}`}`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Abort failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.openBrowser', async (item?: GemStoneSessionItem) => {
      const session = item
        ? item.activeSession
        : await sessionManager.resolveSession();
      if (!session) return;
      SystemBrowser.show(session, exportManager);
    }),

    vscode.commands.registerCommand('gemstone.sessionLogout', async (item: GemStoneSessionItem) => {
      const session = item.activeSession;
      gemstoneFs.closeTabsForSession(session.id);
      exportManager.deleteSessionFiles(session);
      SystemBrowser.disposeForSession(session.id);
      GlobalsBrowser.disposeForSession(session.id);
      ClassBrowser.disposeForSession(session.id);
      sessionManager.logout(session.id);
      sessionTreeProvider.refresh();
      inspectorProvider.removeSessionItems(session.id);
      breakpointManager.clearAllForSession(session.id);
      selectorBreakpointManager.clearAllForSession(session.id);
      vscode.window.showInformationMessage(`Session ${session.id}: Logged out.`);
    }),

    vscode.commands.registerCommand('gemstone.selectSession', async (item?: GemStoneSessionItem) => {
      if (item) {
        sessionManager.selectSession(item.activeSession.id);
      } else {
        await sessionManager.resolveSession();
      }
      sessionTreeProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.exportClasses', async (item?: GemStoneSessionItem) => {
      const session = item
        ? item.activeSession
        : await sessionManager.resolveSession();
      if (!session) return;
      await exportManager.exportSession(session);
    }),

    vscode.commands.registerCommand('gemstone.refreshBrowser', async () => {
      symbolProvider.invalidateCache();
      completionProvider.invalidateCache();
      const session = sessionManager.getSelectedSession();
      if (session) {
        await exportManager.refreshSession(session);
      }
    }),

    vscode.commands.registerCommand('gemstone.refreshTests', () => {
      sunitTestController.refresh();
    }),

    vscode.commands.registerCommand('gemstone.displayIt', () => {
      codeExecutor.displayIt();
    }),

    vscode.commands.registerCommand('gemstone.executeIt', () => {
      codeExecutor.executeIt();
    }),

    vscode.commands.registerCommand('gemstone.inspectIt', () => {
      codeExecutor.inspectIt(inspectorProvider);
    }),

    vscode.commands.registerCommand('gemstone.showTranscript', () => {
      showTranscript();
    }),

    vscode.commands.registerCommand('gemstone.runSunitClass', async (args: { className: string }) => {
      await sunitTestController.runClassByName(args.className);
    }),

    vscode.commands.registerCommand('gemstone.inspectGlobal', async (args: { className: string }) => {
      const existing = inspectorProvider.findRootByLabel(args.className);
      if (existing) {
        await inspectorView.reveal(existing, { select: true, focus: true });
        return;
      }
      await codeExecutor.inspectExpression(inspectorProvider, args.className, args.className);
    }),

    vscode.commands.registerCommand('gemstone.sendersOfSelector', async (args: { selector: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.sendersOf(session, args.selector, env));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await showMethodResults(session, results, `Senders of #${args.selector}`);
    }),

    vscode.commands.registerCommand('gemstone.implementorsOfSelector', async (args: { selector: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.implementorsOf(session, args.selector, env));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await showMethodResults(session, results, `Implementors of #${args.selector}`);
    }),

    vscode.commands.registerCommand('gemstone.browseReferences', async (args: { objectName: string; sessionId: number }) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) return;
      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
      const all: queries.MethodSearchResult[] = [];
      for (let env = 0; env <= maxEnv; env++) {
        all.push(...queries.referencesToObject(session, args.objectName, env));
      }
      const seen = new Set<string>();
      const results = all.filter(r => {
        const key = `${r.className}|${r.isMeta}|${r.selector}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await showMethodResults(session, results, `References to ${args.objectName}`);
    }),

    vscode.commands.registerCommand('gemstone.removeInspectorItem', (node?: InspectorNode) => {
      if (node) inspectorProvider.removeRoot(node);
    }),

    vscode.commands.registerCommand('gemstone.clearInspector', () => {
      inspectorProvider.clearAll();
    }),

    vscode.commands.registerCommand('gemstone.searchMethods', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const term = await vscode.window.showInputBox({
        prompt: 'Search method source code',
        placeHolder: 'Enter search term',
      });
      if (!term) return;

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Searching methods for "${term}"...`,
            cancellable: false,
          },
          () => Promise.resolve(queries.searchMethodSource(session, term, true)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Methods containing "${term}"`);
    }),

    vscode.commands.registerCommand('gemstone.sendersOf', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector();
      if (!selector) return;

      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding senders of #${selector}...`,
            cancellable: false,
          },
          () => {
            const all: queries.MethodSearchResult[] = [];
            for (let env = 0; env <= maxEnv; env++) {
              all.push(...queries.sendersOf(session, selector, env));
            }
            // Deduplicate by class+meta+selector
            const seen = new Set<string>();
            return Promise.resolve(all.filter(r => {
              const key = `${r.className}|${r.isMeta}|${r.selector}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }));
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Senders search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Senders of #${selector}`);
    }),

    vscode.commands.registerCommand('gemstone.implementorsOf', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector();
      if (!selector) return;

      const maxEnv = vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);

      let results: queries.MethodSearchResult[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Finding implementors of #${selector}...`,
            cancellable: false,
          },
          () => {
            const all: queries.MethodSearchResult[] = [];
            for (let env = 0; env <= maxEnv; env++) {
              all.push(...queries.implementorsOf(session, selector, env));
            }
            const seen = new Set<string>();
            return Promise.resolve(all.filter(r => {
              const key = `${r.className}|${r.isMeta}|${r.selector}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }));
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Implementors search failed: ${msg}`);
        return;
      }

      await showMethodResults(session, results, `Implementors of #${selector}`);
    }),

    vscode.commands.registerCommand('gemstone.classHierarchy', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const className = await vscode.window.showInputBox({
        prompt: 'Enter class name',
        placeHolder: 'e.g. Array',
      });
      if (!className) return;

      let results: queries.ClassHierarchyEntry[];
      try {
        results = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching hierarchy for ${className}...`,
            cancellable: false,
          },
          () => Promise.resolve(queries.getClassHierarchy(session, className!)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Hierarchy query failed: ${msg}`);
        return;
      }

      if (results.length === 0) {
        vscode.window.showInformationMessage(`No hierarchy found for ${className}.`);
        return;
      }

      const superCount = results.filter(r => r.kind === 'superclass').length;

      const items = results.map(r => {
        let indent: string;
        if (r.kind === 'superclass') {
          const idx = results.indexOf(r);
          indent = '  '.repeat(idx);
        } else if (r.kind === 'self') {
          indent = '  '.repeat(superCount);
        } else {
          indent = '  '.repeat(superCount + 1);
        }
        const marker = r.kind === 'self' ? ' \u25C0' : '';
        return {
          label: `${indent}${r.className}${marker}`,
          description: r.dictName,
          detail: r.kind === 'self' ? '(target class)' : undefined,
          entry: r,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Hierarchy for ${className}`,
        matchOnDescription: true,
      });
      if (!picked) return;

      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
        `/${encodeURIComponent(picked.entry.dictName)}` +
        `/${encodeURIComponent(picked.entry.className)}` +
        `/definition`
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }),

    vscode.commands.registerCommand('gemstone.toggleSelectorBreakpoint', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      selectorBreakpointManager.toggleBreakpointAtCursor(editor);
    }),

    vscode.commands.registerCommand('gemstone.findClass', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let entries: queries.ClassNameEntry[];
      try {
        entries = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading class list…',
            cancellable: false,
          },
          () => Promise.resolve(queries.getAllClassNames(session)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to load classes: ${msg}`);
        return;
      }

      const items = entries.map(e => ({
        label: e.className,
        description: e.dictName,
        entry: e,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Type to find a class…',
        matchOnDescription: true,
      });
      if (!picked) return;

      if (!SystemBrowser.navigateToClass(session.id, picked.entry.dictName, picked.entry.className)) {
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(picked.entry.dictName)}` +
          `/${encodeURIComponent(picked.entry.className)}` +
          `/definition`
        );
        vscode.commands.executeCommand('gemstone.openDocument', uri);
      }
    }),

    vscode.commands.registerCommand('gemstone.findMethod', async () => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let className: string | undefined;
      let dictName: string | undefined;

      const current = SystemBrowser.getSelectedClassName(session.id);
      if (current) {
        className = current.className;
        dictName = current.dictName;
      } else {
        className = await vscode.window.showInputBox({
          prompt: 'Enter class name',
          placeHolder: 'e.g. Array',
        });
        if (!className) return;
      }

      let methods: queries.MethodEntry[];
      try {
        methods = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Loading methods for ${className}…`,
            cancellable: false,
          },
          () => Promise.resolve(queries.getMethodList(session, className!)),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to load methods: ${msg}`);
        return;
      }

      if (methods.length === 0) {
        vscode.window.showInformationMessage(`No methods found for ${className}.`);
        return;
      }

      const items = methods.map(m => ({
        label: `${m.isMeta ? '(class) ' : ''}${m.selector}`,
        description: m.category,
        method: m,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Type to find a method in ${className}…`,
        matchOnDescription: true,
      });
      if (!picked) return;

      const result: queries.MethodSearchResult = {
        dictName: dictName || '',
        className: className!,
        isMeta: picked.method.isMeta,
        selector: picked.method.selector,
        category: picked.method.category,
      };

      if (!SystemBrowser.navigateTo(session.id, result)) {
        const side = result.isMeta ? 'class' : 'instance';
        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(result.dictName)}` +
          `/${encodeURIComponent(result.className)}` +
          `/${side}` +
          `/${encodeURIComponent(result.category)}` +
          `/${encodeURIComponent(result.selector)}`
        );
        vscode.commands.executeCommand('gemstone.openDocument', uri);
      }
    }),
  );

  // ── SysAdmin ──────────────────────────────────────────────
  if (isWindows()) {
    const wslInfo = getWslInfo();
    vscode.commands.executeCommand('setContext', 'gemstone.isWindows', true);
    vscode.commands.executeCommand('setContext', 'gemstone.wslAvailable', wslInfo.available);
    if (!wslInfo.available) {
      vscode.window.showWarningMessage(
        'GemStone system administration features require Windows Subsystem for Linux (WSL2). ' +
        'Install WSL with: wsl --install',
        'Learn More',
      ).then(choice => {
        if (choice === 'Learn More') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://learn.microsoft.com/en-us/windows/wsl/install'),
          );
        }
      });
    }
  }

  const processManager = new ProcessManager(sysadminStorage);
  const versionManager = new VersionManager(sysadminStorage);
  const databaseManager = new DatabaseManager(sysadminStorage, processManager);

  // OS Configuration (macOS and Linux)
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const osConfigProvider = new OsConfigTreeProvider();
    context.subscriptions.push(
      vscode.window.createTreeView('gemstoneSharedMemory', {
        treeDataProvider: osConfigProvider,
      })
    );
    osConfigProvider.registerCommands(context);
  }

  // Versions
  const versionProvider = new VersionTreeProvider(versionManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneVersions', {
      treeDataProvider: versionProvider,
    })
  );

  // Databases
  const databaseProvider = new DatabaseTreeProvider(sysadminStorage, processManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneDatabases', {
      treeDataProvider: databaseProvider,
      showCollapseAll: true,
    })
  );

  // Processes
  const processProvider = new ProcessTreeProvider(processManager);
  context.subscriptions.push(
    vscode.window.createTreeView('gemstoneProcesses', {
      treeDataProvider: processProvider,
    })
  );

  // Refresh process state on initial load
  processManager.refreshProcesses();

  // Helper to refresh databases + processes together
  function refreshAdminViews() {
    processManager.refreshProcesses();
    databaseProvider.refresh();
    processProvider.refresh();
  }

  // ── SysAdmin Commands ───────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.refreshVersions', () => {
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.downloadVersion', async (item: VersionItem) => {
      const version = item.version;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading GemStone ${version.version}...`,
          cancellable: true,
        },
        async (progress, token) => {
          await versionManager.download(version, progress, token);
        },
      );
      vscode.window.showInformationMessage(`GemStone ${version.version} downloaded.`);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.deleteDownload', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete download of GemStone ${item.version.version}?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteDownload(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.extractVersion', async (item: VersionItem) => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Extracting GemStone ${item.version.version}...`,
        },
        async (progress) => {
          await versionManager.extract(item.version, progress);
        },
      );
      vscode.window.showInformationMessage(`GemStone ${item.version.version} extracted.`);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.deleteExtracted', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete extracted GemStone ${item.version.version}? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      await versionManager.deleteExtracted(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.registerLocalVersion', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select GemStone Product Directory',
      });
      if (!uris || uris.length === 0) return;
      const productPath = uris[0].fsPath;
      const info = SysadminStorage.readVersionTxt(productPath);
      if (!info) {
        vscode.window.showErrorMessage('No valid version.txt found in the selected directory.');
        return;
      }
      const suffix = sysadminStorage.getPlatformSuffix();
      const linkName = `GemStone64Bit${info.version}${suffix}`;
      const linkPath = path.join(sysadminStorage.getRootPath(), linkName);
      if (fs.existsSync(linkPath)) {
        vscode.window.showErrorMessage(`Version ${info.version} already exists in ${sysadminStorage.getRootPath()}.`);
        return;
      }
      sysadminStorage.ensureRootPath();
      fs.symlinkSync(productPath, linkPath);
      appendSysadmin(`Registered local version: ${info.version} → ${productPath}`);
      vscode.window.showInformationMessage(`Registered local GemStone ${info.version} (${info.description || 'local build'}).`);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.unregisterLocalVersion', async (item: VersionItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Unregister local GemStone ${item.version.version}? This only removes the symlink, not the product directory.`,
        { modal: true },
        'Unregister',
      );
      if (confirmed !== 'Unregister') return;
      await versionManager.deleteExtracted(item.version);
      versionProvider.loadVersions();
    }),

    vscode.commands.registerCommand('gemstone.openVersionFolder', (item: VersionItem) => {
      const gsPath = sysadminStorage.getGemstonePath(item.version.version);
      if (gsPath) {
        vscode.env.openExternal(vscode.Uri.file(gsPath));
      }
    }),

    vscode.commands.registerCommand('gemstone.createDatabase', async () => {
      const db = await databaseManager.createDatabase();
      if (db) {
        refreshAdminViews();
        vscode.window.showInformationMessage(`Database "${db.dirName}" created.`);
      }
    }),

    vscode.commands.registerCommand('gemstone.deleteDatabase', async (node: DatabaseNode) => {
      if (node.kind !== 'database') return;
      const deleted = await databaseManager.deleteDatabase(node.db);
      if (deleted) {
        refreshAdminViews();
      }
    }),

    vscode.commands.registerCommand('gemstone.refreshDatabases', () => {
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.startStone', async (node: DatabaseNode) => {
      if (node.kind !== 'stone') return;
      try {
        await processManager.startStone(node.db);
        vscode.window.showInformationMessage(`Stone "${node.db.config.stoneName}" started.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.stopStone', async (node: DatabaseNode) => {
      if (node.kind !== 'stone') return;
      try {
        await processManager.stopStone(node.db);
        vscode.window.showInformationMessage(`Stone "${node.db.config.stoneName}" stopped.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.startNetldi', async (node: DatabaseNode) => {
      if (node.kind !== 'netldi') return;
      try {
        await processManager.startNetldi(node.db);
        vscode.window.showInformationMessage(`NetLDI "${node.db.config.ldiName}" started.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.stopNetldi', async (node: DatabaseNode) => {
      if (node.kind !== 'netldi') return;
      try {
        await processManager.stopNetldi(node.db);
        vscode.window.showInformationMessage(`NetLDI "${node.db.config.ldiName}" stopped.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(msg);
      }
      refreshAdminViews();
    }),

    vscode.commands.registerCommand('gemstone.openDbInFinder', (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.db.path));
    }),

    vscode.commands.registerCommand('gemstone.openDbTerminal', (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      processManager.openTerminal(node.db);
    }),

    vscode.commands.registerCommand('gemstone.createLoginFromDb', async (node: DatabaseNode) => {
      if (!node || node.kind !== 'database') return;
      const db = node.db;
      const login = {
        label: '',
        version: db.config.version,
        gem_host: 'localhost',
        stone: db.config.stoneName,
        gs_user: 'DataCurator',
        gs_password: 'swordfish',
        netldi: db.config.ldiName,
        host_user: '',
        host_password: '',
      };
      // Auto-detect GCI library path
      // On Windows, the sysadmin install is Linux (in WSL) and only has .so files.
      // The Windows .dll must be provided separately via the login editor.
      if (!isWindows()) {
        const gsPath = sysadminStorage.getGemstonePath(db.config.version);
        if (gsPath) {
          const ext = process.platform === 'darwin' ? 'dylib' : 'so';
          const fs = await import('fs');
          const libPath = path.join(gsPath, 'lib', `libgcits-${db.config.version}-64.${ext}`);
          if (fs.existsSync(libPath)) {
            await storage.setGciLibraryPath(db.config.version, libPath);
          }
        }
      }
      LoginEditorPanel.show(storage, treeProvider, login, sysadminStorage);
    }),

    vscode.commands.registerCommand('gemstone.refreshProcesses', () => {
      processProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.replaceExtent', async (node: DatabaseNode) => {
      if (node.kind !== 'stone') return;
      const replaced = await databaseManager.replaceExtent(node.db);
      if (replaced) {
        refreshAdminViews();
      }
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (fileInManager) {
    fileInManager.dispose();
  }
  if (exportManager) {
    exportManager.dispose();
  }
  if (sessionManager) {
    sessionManager.dispose();
  }
  if (!client) return undefined;
  return client.stop();
}
