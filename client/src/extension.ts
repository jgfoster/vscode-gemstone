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
import * as queries from './browserQueries';

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
    showCollapseAll: true,
  });
  context.subscriptions.push(browserTreeView);

  // ── GemStone FileSystem Provider ─────────────────────────
  const gemstoneFs = new GemStoneFileSystemProvider(sessionManager);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('gemstone', gemstoneFs, {
      isCaseSensitive: true,
    })
  );

  // Set language mode for gemstone:// documents
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === 'gemstone') {
        vscode.languages.setTextDocumentLanguage(doc, 'gemstone-smalltalk');
      }
    })
  );

  // ── Debugger ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('gemstone', {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterInlineImplementation(
          new GemStoneDebugSession(sessionManager),
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

  // ── Commands ───────────────────────────────────────────
  context.subscriptions.push(
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
    }),

    vscode.commands.registerCommand('gemstone.newClass', (node?: BrowserNode) => {
      const session = sessionManager.getSelectedSession();
      if (!session) {
        vscode.window.showErrorMessage('No active GemStone session.');
        return;
      }
      const dictName = node && node.kind === 'dictionary' ? node.name : 'UserGlobals';
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}/${encodeURIComponent(dictName)}/new-class`
      );
      vscode.commands.executeCommand('vscode.open', uri);
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

      if (node && node.kind === 'category') {
        dictName = node.dictName;
        className = node.className;
        isMeta = node.isMeta;
        category = node.name;
      } else if (node && node.kind === 'side') {
        dictName = node.dictName;
        className = node.className;
        isMeta = node.isMeta;
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
      const uri = vscode.Uri.parse(
        `gemstone://${session.id}` +
        `/${encodeURIComponent(dictName)}` +
        `/${encodeURIComponent(className)}` +
        `/${side}` +
        `/${encodeURIComponent(category)}` +
        `/new-method`
      );
      vscode.commands.executeCommand('vscode.open', uri);
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
        queries.deleteClass(session, node.dictName, node.name);
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

      const dictNames = queries.getDictionaryNames(session)
        .filter(d => d !== node.dictName);
      if (dictNames.length === 0) {
        vscode.window.showInformationMessage('No other dictionaries available.');
        return;
      }

      const target = await vscode.window.showQuickPick(dictNames, {
        placeHolder: `Move ${node.name} from ${node.dictName} to...`,
      });
      if (!target) return;

      try {
        queries.moveClass(session, node.dictName, target, node.name);
        vscode.window.showInformationMessage(`Moved ${node.name} to ${target}`);
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
        queries.moveDictionaryUp(session, node.name);
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
        queries.moveDictionaryDown(session, node.name);
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
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (sessionManager) {
    sessionManager.dispose();
  }
  if (!client) return undefined;
  return client.stop();
}
