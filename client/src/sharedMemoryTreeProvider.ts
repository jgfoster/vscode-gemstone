import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';

type OsConfigNode =
  | { kind: 'loading' }
  | { kind: 'sharedMemoryStatus'; configured: boolean; gbLabel: string }
  | { kind: 'removeIpcStatus'; configured: boolean }
  | { kind: 'action'; text: string; command: string };

export class OsConfigTreeProvider implements vscode.TreeDataProvider<OsConfigNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OsConfigNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private extensionPath = '';
  private _cache: OsConfigNode[] | undefined;

  refresh(): void {
    this._cache = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  private getSharedMemory(): Promise<{ shmmax: number; shmall: number } | undefined> {
    return new Promise((resolve) => {
      const cmd = process.platform === 'linux'
        ? 'sysctl kernel.shmmax kernel.shmall'
        : 'sysctl kern.sysv.shmmax kern.sysv.shmall';
      exec(cmd, { encoding: 'utf-8' }, (error, output) => {
        if (error) { resolve(undefined); return; }
        let maxMatch: RegExpMatchArray | null;
        let allMatch: RegExpMatchArray | null;
        if (process.platform === 'linux') {
          maxMatch = output.match(/kernel\.shmmax\s*=\s*(\d+)/);
          allMatch = output.match(/kernel\.shmall\s*=\s*(\d+)/);
        } else {
          maxMatch = output.match(/kern\.sysv\.shmmax:\s*(\d+)/);
          allMatch = output.match(/kern\.sysv\.shmall:\s*(\d+)/);
        }
        if (!maxMatch || !allMatch) { resolve(undefined); return; }
        resolve({
          shmmax: parseInt(maxMatch[1], 10),
          shmall: parseInt(allMatch[1], 10),
        });
      });
    });
  }

  private getRemoveIpc(): boolean {
    // Collect all relevant logind config files in precedence order.
    // systemd applies them in alphabetical order; last RemoveIPC= wins.
    const files: string[] = ['/etc/systemd/logind.conf'];
    try {
      const dropInDir = '/etc/systemd/logind.conf.d';
      if (fs.existsSync(dropInDir)) {
        files.push(
          ...fs.readdirSync(dropInDir)
            .filter((f) => f.endsWith('.conf'))
            .sort()
            .map((f) => path.join(dropInDir, f))
        );
      }
    } catch { /* ignore */ }

    let removeIpc: boolean | undefined;
    for (const file of files) {
      try {
        for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
          const match = line.match(/^\s*RemoveIPC\s*=\s*(\w+)\s*$/i);
          if (match) {
            removeIpc = match[1].toLowerCase() === 'no';
          }
        }
      } catch { /* ignore */ }
    }
    return removeIpc === true;
  }

  getTreeItem(node: OsConfigNode): vscode.TreeItem {
    if (node.kind === 'loading') {
      const item = new vscode.TreeItem('Checking OS configuration…', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      return item;
    }

    if (node.kind === 'sharedMemoryStatus') {
      const item = new vscode.TreeItem(
        node.configured
          ? `Shared memory: ${node.gbLabel} GB (configured)`
          : 'Shared memory not configured (< 4 GB)',
        node.configured
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.configured ? 'check' : 'warning',
        new vscode.ThemeColor(node.configured ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      if (!node.configured) {
        item.tooltip = 'GemStone requires at least 4 GB shared memory.';
      }
      return item;
    }

    if (node.kind === 'removeIpcStatus') {
      const item = new vscode.TreeItem(
        node.configured ? 'RemoveIPC=no (configured)' : 'RemoveIPC not configured',
        node.configured
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.configured ? 'check' : 'warning',
        new vscode.ThemeColor(node.configured ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      if (!node.configured) {
        item.tooltip =
          'Without RemoveIPC=no, systemd will destroy GemStone shared memory (killing the Stone) when the session that started it logs out.';
      }
      return item;
    }

    // action node
    const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
    item.command = { command: node.command, title: node.text };
    const isTerminal = [
      'gemstone.runSetSharedMemory',
      'gemstone.runSetSharedMemoryLinux',
      'gemstone.runSetRemoveIPC',
    ].includes(node.command);
    if (isTerminal) {
      item.iconPath = new vscode.ThemeIcon('terminal');
      if (node.command === 'gemstone.runSetSharedMemoryLinux') {
        item.tooltip = 'Open a terminal and run the setup script with sudo. Changes take effect immediately; no restart required.';
      } else if (node.command === 'gemstone.runSetRemoveIPC') {
        item.tooltip = 'Open a terminal and run the setup script with sudo.';
      } else {
        item.tooltip = 'Open a terminal and run the setup script with sudo';
      }
    } else {
      item.iconPath = new vscode.ThemeIcon('info');
      if (node.command === 'gemstone.removeIpcInfo') {
        item.tooltip = 'Restart your computer, or run: sudo systemctl restart systemd-logind';
      } else {
        item.tooltip = 'Restart required after running the script';
      }
    }
    return item;
  }

  getChildren(node?: OsConfigNode): OsConfigNode[] | Promise<OsConfigNode[]> {
    if (!node) {
      if (this._cache) return this._cache;

      // Return a loading indicator immediately, then fetch async and refresh.
      this._loadConfig();
      return [{ kind: 'loading' }];
    }

    if (node.kind === 'sharedMemoryStatus' && !node.configured) {
      if (process.platform === 'linux') {
        return [
          { kind: 'action', text: 'Run setup script (requires sudo)', command: 'gemstone.runSetSharedMemoryLinux' },
        ];
      }
      return [
        { kind: 'action', text: 'Run setup script (requires sudo)', command: 'gemstone.runSetSharedMemory' },
        { kind: 'action', text: 'Restart computer after running', command: 'gemstone.sharedMemoryInfo' },
      ];
    }

    if (node.kind === 'removeIpcStatus' && !node.configured) {
      return [
        { kind: 'action', text: 'Run setup script (requires sudo)', command: 'gemstone.runSetRemoveIPC' },
        { kind: 'action', text: 'Restart computer or restart systemd-logind', command: 'gemstone.removeIpcInfo' },
      ];
    }

    return [];
  }

  private async _loadConfig(): Promise<void> {
    const nodes: OsConfigNode[] = [];

    const mem = await this.getSharedMemory();
    if (mem) {
      const shmmaxGb = mem.shmmax / Math.pow(2, 30);
      const shmallGb = mem.shmall / Math.pow(2, 18);
      const minGb = Math.min(shmmaxGb, shmallGb);
      const configured = shmmaxGb >= 4 && shmallGb >= 4;
      const gbLabel = minGb > 1024 ? '≥ 4' : String(Math.round(minGb * 10) / 10);
      nodes.push({ kind: 'sharedMemoryStatus', configured, gbLabel });
    } else {
      nodes.push({ kind: 'sharedMemoryStatus', configured: false, gbLabel: '0' });
    }

    if (process.platform === 'linux') {
      nodes.push({ kind: 'removeIpcStatus', configured: this.getRemoveIpc() });
    }

    this._cache = nodes;
    this._onDidChangeTreeData.fire(undefined);
  }

  registerCommands(context: vscode.ExtensionContext): void {
    this.extensionPath = context.extensionPath;
    context.subscriptions.push(
      vscode.commands.registerCommand('gemstone.runSetSharedMemory', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setSharedMemory.sh');
        const terminal = vscode.window.createTerminal('GemStone: Shared Memory Setup');
        terminal.show();
        terminal.sendText(`sudo "${scriptPath}"`);
      }),
      vscode.commands.registerCommand('gemstone.runSetSharedMemoryLinux', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setSharedMemoryLinux.sh');
        const terminal = vscode.window.createTerminal('GemStone: Shared Memory Setup');
        terminal.show();
        terminal.sendText(`sudo "${scriptPath}"`);
      }),
      vscode.commands.registerCommand('gemstone.runSetRemoveIPC', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setRemoveIPC.sh');
        const terminal = vscode.window.createTerminal('GemStone: RemoveIPC Setup');
        terminal.show();
        terminal.sendText(`sudo "${scriptPath}"`);
      }),
      vscode.commands.registerCommand('gemstone.sharedMemoryInfo', () => {
        vscode.window.showInformationMessage(
          'After running the setup script, restart your computer for the shared memory changes to take effect.',
        );
      }),
      vscode.commands.registerCommand('gemstone.removeIpcInfo', () => {
        vscode.window.showInformationMessage(
          'To apply: restart your computer, or run: sudo systemctl restart systemd-logind',
        );
      }),
    );
  }
}
