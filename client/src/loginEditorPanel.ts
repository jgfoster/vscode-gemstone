import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GemStoneLogin, DEFAULT_LOGIN, loginLabel } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { LoginTreeProvider } from './loginTreeProvider';
import { SysadminStorage } from './sysadminStorage';
import {
  setLoginPassword,
  getLoginPassword,
  deleteLoginPassword,
} from './loginCredentials';

export class LoginEditorPanel {
  private static currentPanel: LoginEditorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  /** Collect versions that have a GCI library available */
  private static getAvailableVersions(storage: LoginStorage, sysadminStorage: SysadminStorage): string[] {
    const versionSet = new Set<string>();
    // Extracted versions have GCI libraries in their lib/ directory
    for (const v of sysadminStorage.getExtractedVersions()) {
      versionSet.add(v);
    }
    // Versions with manually configured GCI library paths
    const config = vscode.workspace.getConfiguration('gemstone');
    const gciLibraries = config.get<Record<string, string>>('gciLibraries', {});
    for (const v of Object.keys(gciLibraries)) {
      versionSet.add(v);
    }
    const versions = [...versionSet];
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
  }

  static async show(
    storage: LoginStorage,
    treeProvider: LoginTreeProvider,
    existingLogin?: GemStoneLogin,
    sysadminStorage?: SysadminStorage,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const versions = sysadminStorage
      ? LoginEditorPanel.getAvailableVersions(storage, sysadminStorage)
      : [];

    let login: GemStoneLogin = existingLogin ?? {
      ...DEFAULT_LOGIN,
      version: versions[0] ?? '',
    };

    // If the login has its password in the keychain, load it so the user can
    // view or change it in the editor.
    if (existingLogin?.password_in_keychain) {
      const pw = await getLoginPassword(existingLogin);
      if (pw !== undefined) {
        login = { ...login, gs_password: pw };
      }
    }

    if (LoginEditorPanel.currentPanel) {
      LoginEditorPanel.currentPanel.panel.reveal(column);
      LoginEditorPanel.currentPanel.versions = versions;
      LoginEditorPanel.currentPanel.update(login);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneLoginEditor',
      existingLogin ? `Edit: ${loginLabel(existingLogin)}` : 'New GemStone Login',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    LoginEditorPanel.currentPanel = new LoginEditorPanel(
      panel, storage, treeProvider, login, versions,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private storage: LoginStorage,
    private treeProvider: LoginTreeProvider,
    private login: GemStoneLogin,
    private versions: string[],
  ) {
    this.panel = panel;
    this.update(login);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'save':
            await this.handleSave(message.data, message.originalLabel);
            break;
          case 'requestData':
            this.panel.webview.postMessage({
              command: 'loadData',
              data: this.login,
              versions: this.versions,
            });
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  private async handleSave(data: GemStoneLogin, originalLabel?: string): Promise<void> {
    data.label = loginLabel(data);

    if (data.password_in_keychain) {
      // Store the password in the OS keychain and strip it from the settings
      // object before we persist.
      if (data.gs_password) {
        await setLoginPassword(data);
      }
      data = { ...data, gs_password: '' };
    } else {
      // If keychain was previously enabled and the user unchecked it, clean up
      // the stored keychain entry so we don't leave stale secrets behind.
      if (this.login.password_in_keychain) {
        await deleteLoginPassword(this.login);
      }
    }

    await this.storage.saveLogin(data, originalLabel);
    this.treeProvider.refresh();
    this.login = data;
    this.panel.title = `Edit: ${data.label}`;
    vscode.window.showInformationMessage(`Login "${data.label}" saved.`);
  }

  private update(login: GemStoneLogin): void {
    this.login = login;
    this.panel.webview.html = this.getHtml();
    this.panel.webview.postMessage({ command: 'loadData', data: login, versions: this.versions });
  }

  private dispose(): void {
    LoginEditorPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>GemStone Login</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      max-width: 500px;
    }
    h2 {
      margin-top: 0;
      font-weight: 400;
    }
    label {
      display: block;
      margin-top: 12px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    select, input[type="text"], input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    select:focus, input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .field-group {
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-bottom: 12px;
      margin-bottom: 4px;
    }
    .button-row {
      margin-top: 20px;
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .checkbox-row input[type="checkbox"] {
      margin: 0;
    }
    label.inline-label {
      display: inline;
      margin: 0;
      font-weight: 400;
      cursor: pointer;
    }
    .hint {
      font-size: 0.9em;
      opacity: 0.7;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <h2>GemStone Login Parameters</h2>

  <div class="field-group">
    <label for="version">GemStone Version</label>
    <select id="version"></select>

    <label for="gem_host">Gem Host</label>
    <input type="text" id="gem_host" placeholder="localhost">

    <label for="stone">Stone</label>
    <input type="text" id="stone" placeholder="gs64stone">

    <label for="netldi">NetLDI</label>
    <input type="text" id="netldi" placeholder="gs64ldi">
  </div>

  <div class="field-group">
    <label for="gs_user">GemStone User</label>
    <input type="text" id="gs_user" placeholder="DataCurator">

    <label for="gs_password">GemStone Password</label>
    <input type="password" id="gs_password">
    <div class="checkbox-row">
      <input type="checkbox" id="password_in_keychain">
      <label for="password_in_keychain" class="inline-label">Store password in OS keychain</label>
    </div>
    <div class="hint">Leave password blank to be prompted on each login.</div>
  </div>

  <div class="field-group">
    <label for="host_user">Host User</label>
    <input type="text" id="host_user">

    <label for="host_password">Host Password</label>
    <input type="password" id="host_password">
  </div>

  <div class="button-row">
    <button id="saveBtn">Save</button>
    <button id="cancelBtn" class="secondary">Cancel</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const fields = ['version','gem_host','stone','gs_user','gs_password','netldi','host_user','host_password'];
    let originalLabel = null;

    vscode.postMessage({ command: 'requestData' });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadData') {
        originalLabel = msg.data.label || null;
        // Populate version dropdown
        const versionSelect = document.getElementById('version');
        const currentVersion = msg.data.version || '';
        const versions = msg.versions || [];
        versionSelect.innerHTML = '';
        const versionSet = new Set(versions);
        if (currentVersion && !versionSet.has(currentVersion)) {
          versions.unshift(currentVersion);
        }
        for (const v of versions) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          versionSelect.appendChild(opt);
        }
        versionSelect.value = currentVersion;
        // Populate other fields
        for (const f of fields) {
          if (f === 'version') continue;
          const el = document.getElementById(f);
          if (el) el.value = msg.data[f] || '';
        }
        document.getElementById('password_in_keychain').checked =
          Boolean(msg.data.password_in_keychain);
      }
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const data = {};
      for (const f of fields) {
        data[f] = document.getElementById(f).value;
      }
      data.password_in_keychain = document.getElementById('password_in_keychain').checked;
      vscode.postMessage({ command: 'save', data, originalLabel });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'requestData' });
    });
  </script>
</body>
</html>`;
  }
}
