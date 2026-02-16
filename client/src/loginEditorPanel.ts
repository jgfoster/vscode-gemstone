import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GemStoneLogin, DEFAULT_LOGIN } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { LoginTreeProvider } from './loginTreeProvider';

export class LoginEditorPanel {
  private static currentPanel: LoginEditorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static show(
    storage: LoginStorage,
    treeProvider: LoginTreeProvider,
    existingLogin?: GemStoneLogin,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (LoginEditorPanel.currentPanel) {
      LoginEditorPanel.currentPanel.panel.reveal(column);
      LoginEditorPanel.currentPanel.update(existingLogin ?? { ...DEFAULT_LOGIN });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneLoginEditor',
      existingLogin ? `Edit: ${existingLogin.label}` : 'New GemStone Login',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    LoginEditorPanel.currentPanel = new LoginEditorPanel(
      panel, storage, treeProvider, existingLogin ?? { ...DEFAULT_LOGIN },
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private storage: LoginStorage,
    private treeProvider: LoginTreeProvider,
    private login: GemStoneLogin,
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
            });
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  private async handleSave(data: GemStoneLogin, originalLabel?: string): Promise<void> {
    if (!data.label.trim()) {
      vscode.window.showErrorMessage('Login label is required.');
      return;
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
    this.panel.webview.postMessage({ command: 'loadData', data: login });
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
    input[type="text"], input[type="password"] {
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
    input:focus {
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
  </style>
</head>
<body>
  <h2>GemStone Login Parameters</h2>

  <div class="field-group">
    <label for="label">Label *</label>
    <input type="text" id="label" placeholder="My GemStone Server">
  </div>

  <div class="field-group">
    <label for="version">GemStone Version</label>
    <input type="text" id="version" placeholder="3.7.2">

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
    const fields = ['label','version','gem_host','stone','gs_user','gs_password','netldi','host_user','host_password'];
    let originalLabel = null;

    vscode.postMessage({ command: 'requestData' });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadData') {
        originalLabel = msg.data.label || null;
        for (const f of fields) {
          const el = document.getElementById(f);
          if (el) el.value = msg.data[f] || '';
        }
      }
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const data = {};
      for (const f of fields) {
        data[f] = document.getElementById(f).value;
      }
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
