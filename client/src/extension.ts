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
import { LoginEditorPanel } from './loginEditorPanel';
import { SessionManager } from './sessionManager';
import { SessionTreeProvider, GemStoneSessionItem } from './sessionTreeProvider';
import { CodeExecutor } from './codeExecutor';
import { BrowserTreeProvider, BrowserNode } from './browserTreeProvider';
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
import * as queries from './browserQueries';
import { getGciLog } from './gciLog';

let client: LanguageClient;
let sessionManager: SessionManager;

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
        browserTreeProvider.refresh();
      }
    })
  );

  // ── Session Management ───────────────────────────────────
  sessionManager = new SessionManager();
  const sessionTreeProvider = new SessionTreeProvider(sessionManager);

  const sessionTreeView = vscode.window.createTreeView('gemstoneSessions', {
    treeDataProvider: sessionTreeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(sessionTreeView);

  // ── Class/Method Browser ────────────────────────────────
  const browserTreeProvider = new BrowserTreeProvider(sessionManager);

  const browserTreeView = vscode.window.createTreeView('gemstoneBrowser', {
    treeDataProvider: browserTreeProvider,
    dragAndDropController: browserTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(browserTreeView);

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

  // Sync browser tree selection with active editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || editor.document.uri.scheme !== 'gemstone') return;
      const log = getGciLog();
      log.appendLine(`[Tree] editor changed: ${editor.document.uri.toString()}`);
      const node = browserTreeProvider.nodeForUri(editor.document.uri);
      if (!node) {
        log.appendLine('[Tree] nodeForUri returned null');
        return;
      }
      log.appendLine(`[Tree] revealing ${node.kind} node, id=${JSON.stringify(node)}`);
      browserTreeView.reveal(node, { select: true, focus: false, expand: true })
        .then(
          () => log.appendLine('[Tree] reveal succeeded'),
          (err: unknown) => log.appendLine(`[Tree] reveal failed: ${err}`),
        );
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
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(providerSelectors, definitionProvider),
    vscode.languages.registerHoverProvider(providerSelectors, hoverProvider),
    vscode.languages.registerCompletionItemProvider(providerSelectors, completionProvider),
  );

  // ── Breakpoints + Debugger ───────────────────────────────
  const breakpointManager = new BreakpointManager(sessionManager);
  breakpointManager.register(context);

  const selectorBreakpointManager = new SelectorBreakpointManager(sessionManager);
  selectorBreakpointManager.register(context);

  // Re-apply breakpoints after method recompilation
  context.subscriptions.push(
    gemstoneFs.onDidChangeFile(events => {
      for (const event of events) {
        if (event.type === vscode.FileChangeType.Changed) {
          breakpointManager.invalidateForUri(event.uri);
          selectorBreakpointManager.invalidateForUri(event.uri);
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

  // ── Status Bar: Active Session ─────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100
  );
  statusBarItem.command = 'gemstone.selectSession';
  context.subscriptions.push(statusBarItem);

  function updateStatusBar() {
    const session = sessionManager.getSelectedSession();
    if (session) {
      statusBarItem.text = `$(database) ${session.login.label}`;
      statusBarItem.tooltip = `GemStone: ${session.login.gs_user} in ${session.login.stone} (click to change)`;
      statusBarItem.show();
    } else if (sessionManager.getSessions().length > 0) {
      statusBarItem.text = '$(database) No session selected';
      statusBarItem.tooltip = 'Click to select a GemStone session';
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  }

  context.subscriptions.push(
    sessionManager.onDidChangeSelection(() => updateStatusBar())
  );
  updateStatusBar();

  // ── Shared Helpers ─────────────────────────────────────

  async function resolveSelector(node?: BrowserNode): Promise<string | undefined> {
    if (node && node.kind === 'method') return node.selector;

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

  // ── Commands ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gemstone.openDocument', async (uri: vscode.Uri) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    vscode.commands.registerCommand('gemstone.addLogin', () => {
      LoginEditorPanel.show(storage, treeProvider);
    }),

    vscode.commands.registerCommand('gemstone.editLogin', (item: GemStoneLoginItem) => {
      LoginEditorPanel.show(storage, treeProvider, item.login);
    }),

    vscode.commands.registerCommand('gemstone.deleteLogin', async (item: GemStoneLoginItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete login "${item.login.label}"?`,
        { modal: true },
        'Delete',
      );
      if (confirmed === 'Delete') {
        await storage.deleteLogin(item.login.label);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('gemstone.duplicateLogin', async (item: GemStoneLoginItem) => {
      const copy = { ...item.login, label: `${item.login.label} (copy)` };
      await storage.saveLogin(copy);
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.login', async (item: GemStoneLoginItem) => {
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

      try {
        const session = sessionManager.login(login, gciPath);
        sessionTreeProvider.refresh();
        vscode.window.showInformationMessage(
          `Connected to ${login.stone} (${session.stoneVersion}) on ${login.gem_host} as ${login.gs_user}`
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Login failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.sessionCommit', (item: GemStoneSessionItem) => {
      try {
        const { success, err } = sessionManager.commit(item.activeSession.id);
        if (success) {
          vscode.window.showInformationMessage(
            `Session ${item.activeSession.id}: Commit succeeded.`
          );
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

    vscode.commands.registerCommand('gemstone.sessionAbort', (item: GemStoneSessionItem) => {
      try {
        const { success, err } = sessionManager.abort(item.activeSession.id);
        if (success) {
          vscode.window.showInformationMessage(
            `Session ${item.activeSession.id}: Abort succeeded.`
          );
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

    vscode.commands.registerCommand('gemstone.sessionLogout', (item: GemStoneSessionItem) => {
      const { id } = item.activeSession;
      sessionManager.logout(id);
      sessionTreeProvider.refresh();
      inspectorProvider.removeSessionItems(id);
      breakpointManager.clearAllForSession(id);
      selectorBreakpointManager.clearAllForSession(id);
      vscode.window.showInformationMessage(`Session ${id}: Logged out.`);
    }),

    vscode.commands.registerCommand('gemstone.selectSession', async (item?: GemStoneSessionItem) => {
      if (item) {
        sessionManager.selectSession(item.activeSession.id);
      } else {
        await sessionManager.resolveSession();
      }
      sessionTreeProvider.refresh();
    }),

    vscode.commands.registerCommand('gemstone.refreshBrowser', () => {
      browserTreeProvider.refresh();
      symbolProvider.invalidateCache();
      completionProvider.invalidateCache();
    }),

    vscode.commands.registerCommand('gemstone.refreshTests', () => {
      sunitTestController.refresh();
    }),

    vscode.commands.registerCommand('gemstone.runSunitClass', async (node?: BrowserNode) => {
      if (!node || node.kind !== 'class') return;
      await sunitTestController.runClassByName(node.name);
    }),

    vscode.commands.registerCommand('gemstone.newClassCategory', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session.');
        return;
      }
      const categoryName = await vscode.window.showInputBox({
        prompt: 'Enter the new class category name',
        placeHolder: 'Category name',
      });
      if (!categoryName) return;
      let dictName = 'UserGlobals';
      if (node && node.kind === 'dictionary') dictName = node.name;
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}/${encodeURIComponent(dictName)}/new-class?category=${encodeURIComponent(categoryName)}`
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }),

    vscode.commands.registerCommand('gemstone.newClass', (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session.');
        return;
      }
      let dictName = 'UserGlobals';
      if (node && node.kind === 'dictionary') dictName = node.name;
      else if (node && node.kind === 'classCategory') dictName = node.dictName;
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}/${encodeURIComponent(dictName)}/new-class`
      );
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }),

    vscode.commands.registerCommand('gemstone.newMethod', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session.');
        return;
      }

      let dictName: string;
      let className: string;
      let isMeta: boolean;
      let category: string;
      let environmentId = 0;

      if (node && node.kind === 'category') {
        dictName = node.dictName;
        className = node.className;
        isMeta = node.isMeta;
        environmentId = node.environmentId;
        category = node.name;
      } else if (node && node.kind === 'side') {
        dictName = node.dictName;
        className = node.className;
        isMeta = node.isMeta;
        environmentId = node.environmentId;
        const input = await vscode.window.showInputBox({
          prompt: `Category for new method on ${className}${isMeta ? ' class' : ''}`,
          placeHolder: 'e.g. accessing',
        });
        if (!input) return;
        category = input;
      } else {
        vscode.window.showErrorMessage('Select a category or side to add a method.');
        return;
      }

      const side = isMeta ? 'class' : 'instance';
      let uriStr =
        `gemstone://${session.id}` +
        `/${encodeURIComponent(dictName)}` +
        `/${encodeURIComponent(className)}` +
        `/${side}` +
        `/${encodeURIComponent(category)}` +
        `/new-method`;
      if (environmentId > 0) {
        uriStr += `?env=${environmentId}`;
      }
      const uri = vscode.Uri.parse(uriStr);
      vscode.commands.executeCommand('gemstone.openDocument', uri);
    }),

    vscode.commands.registerCommand('gemstone.deleteMethod', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'method') return;

      const recv = `${node.className}${node.isMeta ? ' class' : ''}`;
      const confirmed = await vscode.window.showWarningMessage(
        `Delete ${recv}>>#${node.selector}?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;

      try {
        queries.deleteMethod(session, node.className, node.isMeta, node.selector);
        vscode.window.showInformationMessage(`Deleted ${recv}>>#${node.selector}`);
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Delete failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.recategorizeMethod', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'method') return;

      const recv = `${node.className}${node.isMeta ? ' class' : ''}`;
      const newCategory = await vscode.window.showInputBox({
        prompt: `Move ${recv}>>#${node.selector} to category`,
        value: node.category,
      });
      if (!newCategory || newCategory === node.category) return;

      try {
        queries.recategorizeMethod(session, node.className, node.isMeta, node.selector, newCategory);
        vscode.window.showInformationMessage(
          `Moved ${recv}>>#${node.selector} to '${newCategory}'`
        );
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Move failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.renameCategory', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'category') return;

      const recv = `${node.className}${node.isMeta ? ' class' : ''}`;
      const newName = await vscode.window.showInputBox({
        prompt: `Rename category '${node.name}' on ${recv}`,
        value: node.name,
      });
      if (!newName || newName === node.name) return;

      try {
        queries.renameCategory(session, node.className, node.isMeta, node.name, newName);
        vscode.window.showInformationMessage(
          `Renamed category '${node.name}' to '${newName}' on ${recv}`
        );
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Rename failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.deleteClass', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'class') return;

      const confirmed = await vscode.window.showWarningMessage(
        `Remove ${node.name} from ${node.dictName}?`,
        { modal: true },
        'Remove',
      );
      if (confirmed !== 'Remove') return;

      try {
        queries.deleteClass(session, node.dictIndex, node.name);
        vscode.window.showInformationMessage(`Removed ${node.name} from ${node.dictName}`);
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Remove failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.moveClass', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'class') return;

      const allDicts = queries.getDictionaryNames(session)
        .map((name, i) => ({ label: name, dictIndex: i + 1 }))
        .filter(d => d.dictIndex !== node.dictIndex);
      if (allDicts.length === 0) {
        vscode.window.showInformationMessage('No other dictionaries available.');
        return;
      }

      const target = await vscode.window.showQuickPick(allDicts, {
        placeHolder: `Move ${node.name} from ${node.dictName} to...`,
      });
      if (!target) return;

      try {
        queries.moveClass(session, node.dictIndex, target.dictIndex, node.name);
        vscode.window.showInformationMessage(`Moved ${node.name} to ${target.label}`);
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Move failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.addDictionary', async () => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Name for new SymbolDictionary',
        placeHolder: 'e.g. MyDictionary',
      });
      if (!name) return;

      try {
        queries.addDictionary(session, name);
        vscode.window.showInformationMessage(`Created dictionary ${name}`);
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to create dictionary: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.moveDictionaryUp', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'dictionary') return;

      try {
        queries.moveDictionaryUp(session, node.dictIndex);
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Move failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('gemstone.moveDictionaryDown', async (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session || !node || node.kind !== 'dictionary') return;

      try {
        queries.moveDictionaryDown(session, node.dictIndex);
        browserTreeProvider.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Move failed: ${msg}`);
      }
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

    vscode.commands.registerCommand('gemstone.inspectGlobal', async (node?: BrowserNode) => {
      if (!node || node.kind !== 'global') return;
      const code =
        `(System myUserProfile symbolList at: ${node.dictIndex}) at: #'${node.name}'`;
      await codeExecutor.inspectExpression(inspectorProvider, code, node.name);
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

    vscode.commands.registerCommand('gemstone.sendersOf', async (node?: BrowserNode) => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector(node);
      if (!selector) return;

      const envId = (node && node.kind === 'method') ? node.environmentId : 0;
      const maxEnv = (!node && vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0) > 0)
        ? vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0)
        : envId;

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
            for (let env = (node ? envId : 0); env <= maxEnv; env++) {
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

    vscode.commands.registerCommand('gemstone.implementorsOf', async (node?: BrowserNode) => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      const selector = await resolveSelector(node);
      if (!selector) return;

      const envId = (node && node.kind === 'method') ? node.environmentId : 0;
      const maxEnv = (!node && vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0) > 0)
        ? vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0)
        : envId;

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
            for (let env = (node ? envId : 0); env <= maxEnv; env++) {
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

    vscode.commands.registerCommand('gemstone.classHierarchy', async (node?: BrowserNode) => {
      const session = await sessionManager.resolveSession();
      if (!session) return;

      let className: string | undefined;
      if (node && node.kind === 'class') {
        className = node.name;
      } else {
        className = await vscode.window.showInputBox({
          prompt: 'Enter class name',
          placeHolder: 'e.g. Array',
        });
      }
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
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (sessionManager) {
    sessionManager.dispose();
  }
  if (!client) return undefined;
  return client.stop();
}
