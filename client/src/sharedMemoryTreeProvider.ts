import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { needsWsl, getWslInfo, invalidateWslCache, wslExecSync } from './wslBridge';
import { toWslPath } from './wslFs';

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

type OsConfigNode =
  | { kind: 'loading' }
  | { kind: 'sharedMemoryStatus'; configured: boolean; gbLabel: string }
  | { kind: 'removeIpcStatus'; configured: boolean }
  | { kind: 'wslStatus'; distro: string; wslVersion: number | undefined }
  | { kind: 'action'; text: string; command: string };

/** Read the current sysctl shared memory values. */
export function getSharedMemory(): Promise<{ shmmax: number; shmall: number } | undefined> {
  return new Promise((resolve) => {
    // On Windows the sysctl lives inside WSL; the parse format matches Linux.
    const linuxLike = process.platform === 'linux' || needsWsl();
    const cmd = linuxLike
      ? (needsWsl()
          ? 'wsl.exe -e sysctl kernel.shmmax kernel.shmall'
          : 'sysctl kernel.shmmax kernel.shmall')
      : 'sysctl kern.sysv.shmmax kern.sysv.shmall';
    exec(cmd, { encoding: 'utf-8' }, (error, output) => {
      if (error) { resolve(undefined); return; }
      const maxMatch = linuxLike
        ? output.match(/kernel\.shmmax\s*=\s*(\d+)/)
        : output.match(/kern\.sysv\.shmmax:\s*(\d+)/);
      const allMatch = linuxLike
        ? output.match(/kernel\.shmall\s*=\s*(\d+)/)
        : output.match(/kern\.sysv\.shmall:\s*(\d+)/);
      if (!maxMatch || !allMatch) { resolve(undefined); return; }
      resolve({
        shmmax: parseInt(maxMatch[1], 10),
        shmall: parseInt(allMatch[1], 10),
      });
    });
  });
}

export class OsConfigTreeProvider implements vscode.TreeDataProvider<OsConfigNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OsConfigNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private extensionPath = '';
  private _cache: OsConfigNode[] | undefined;

  refresh(): void {
    this._cache = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  private getRemoveIpc(): boolean {
    // Routes through WSL on Windows so we inspect the WSL distro's systemd
    // config rather than nonexistent Windows paths. systemd applies drop-ins
    // in alphabetical order after the main file; last RemoveIPC= wins.
    const wsl = needsWsl();
    const readText = wsl
      ? (p: string): string | undefined => {
          try { return wslExecSync(`cat ${shQuote(p)} 2>/dev/null`); } catch { return undefined; }
        }
      : (p: string): string | undefined => {
          try { return fs.readFileSync(p, 'utf-8'); } catch { return undefined; }
        };
    const listConfs = wsl
      ? (dir: string): string[] => {
          try {
            return wslExecSync(`ls -A1 ${shQuote(dir)} 2>/dev/null`)
              .split('\n').map(s => s.trim()).filter(Boolean);
          } catch { return []; }
        }
      : (dir: string): string[] => {
          try { return fs.existsSync(dir) ? fs.readdirSync(dir) : []; } catch { return []; }
        };

    const dropInDir = '/etc/systemd/logind.conf.d';
    const files = [
      '/etc/systemd/logind.conf',
      ...listConfs(dropInDir).filter(f => f.endsWith('.conf')).sort().map(f => `${dropInDir}/${f}`),
    ];

    let removeIpc: boolean | undefined;
    for (const file of files) {
      const content = readText(file);
      if (content === undefined) continue;
      for (const line of content.split('\n')) {
        const match = line.match(/^\s*RemoveIPC\s*=\s*(\w+)\s*$/i);
        if (match) removeIpc = match[1].toLowerCase() === 'no';
      }
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
          : 'Shared memory not configured (< 1 GB)',
        node.configured
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        node.configured ? 'check' : 'warning',
        new vscode.ThemeColor(node.configured ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      if (!node.configured) {
        item.tooltip = 'GemStone requires at least 1 GB shared memory.';
      }
      return item;
    }

    if (node.kind === 'wslStatus') {
      const ok = node.wslVersion === 2;
      const label = ok
        ? `WSL 2 (${node.distro})`
        : node.wslVersion === 1
          ? `WSL 1 (${node.distro}) — upgrade required`
          : `WSL (${node.distro}) — version unknown`;
      const item = new vscode.TreeItem(
        label,
        ok ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(
        ok ? 'check' : 'warning',
        new vscode.ThemeColor(ok ? 'testing.iconPassed' : 'problemsWarningIcon.foreground'),
      );
      if (!ok) {
        item.tooltip = node.wslVersion === 1
          ? 'GemStone requires WSL 2. Run: wsl --set-version ' + node.distro + ' 2'
          : 'Could not determine WSL version for ' + node.distro + '.';
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
      'gemstone.upgradeWsl2',
      'gemstone.runSetSharedMemory',
      'gemstone.runSetSharedMemoryLinux',
      'gemstone.runSetRemoveIPC',
    ].includes(node.command);
    if (isTerminal) {
      item.iconPath = new vscode.ThemeIcon('terminal');
      if (node.command === 'gemstone.upgradeWsl2') {
        item.tooltip = 'Open a terminal and run: wsl --set-version <distro> 2';
      } else if (node.command === 'gemstone.runSetRemoveIPC') {
        item.tooltip = 'Open a terminal and run the setup script with sudo.';
      } else {
        item.tooltip = 'Open a terminal and run the setup script with sudo. Changes take effect immediately; no restart required.';
      }
    } else {
      item.iconPath = new vscode.ThemeIcon('info');
      if (node.command === 'gemstone.removeIpcInfo') {
        item.tooltip = 'Restart your computer, or run: sudo systemctl restart systemd-logind';
      } else {
        item.tooltip = 'Changes take effect immediately; no restart required.';
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

    if (node.kind === 'wslStatus' && node.wslVersion !== 2) {
      return [
        { kind: 'action', text: 'Upgrade to WSL 2', command: 'gemstone.upgradeWsl2' },
      ];
    }

    if (node.kind === 'sharedMemoryStatus' && !node.configured) {
      // Windows+WSL uses the Linux script (executed inside WSL).
      const command = (process.platform === 'linux' || needsWsl())
        ? 'gemstone.runSetSharedMemoryLinux'
        : 'gemstone.runSetSharedMemory';
      return [
        { kind: 'action', text: 'Run setup script (requires sudo)', command },
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
    // Yield to the event loop so subscribers registered after getChildren()
    // are in place before we fire onDidChangeTreeData (needed when the WSL
    // branch has no awaits and would otherwise fire synchronously).
    await Promise.resolve();
    const nodes: OsConfigNode[] = [];

    let showLinuxChecks = process.platform === 'linux';
    if (needsWsl()) {
      const info = getWslInfo();
      const distro = info.defaultDistro ?? 'Unknown';
      nodes.push({ kind: 'wslStatus', distro, wslVersion: info.wslVersion });
      // Only inspect the WSL distro once it's on WSL 2; earlier versions
      // need to upgrade first, so extra warnings would just be noise.
      showLinuxChecks = info.wslVersion === 2;
    }

    if (showLinuxChecks || process.platform === 'darwin') {
      const mem = await getSharedMemory();
      if (mem) {
        const shmmaxGb = mem.shmmax / Math.pow(2, 30);
        const shmallGb = mem.shmall / Math.pow(2, 18);
        const minGb = Math.min(shmmaxGb, shmallGb);
        const configured = shmmaxGb >= 1 && shmallGb >= 1;
        const gbLabel = minGb > 1024 ? '≥ 1' : String(Math.round(minGb * 10) / 10);
        nodes.push({ kind: 'sharedMemoryStatus', configured, gbLabel });
      } else {
        nodes.push({ kind: 'sharedMemoryStatus', configured: false, gbLabel: '0' });
      }
    }

    if (showLinuxChecks) {
      nodes.push({ kind: 'removeIpcStatus', configured: this.getRemoveIpc() });
    }

    this._cache = nodes;
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Open a terminal ready to run a bash setup script with sudo. On Windows
   * the terminal is a WSL shell so the script (delivered as /mnt/<drive>/...)
   * executes inside the Linux distro GemStone actually runs under.
   */
  private createSetupTerminal(name: string, scriptPath: string): vscode.Terminal {
    if (needsWsl()) {
      const terminal = vscode.window.createTerminal({
        name,
        shellPath: 'wsl.exe',
        shellArgs: ['-e', 'bash'],
      });
      terminal.show();
      terminal.sendText(`sudo ${shQuote(toWslPath(scriptPath))} && exit`);
      return terminal;
    }
    const terminal = vscode.window.createTerminal(name);
    terminal.show();
    terminal.sendText(`sudo "${scriptPath}" && exit`);
    return terminal;
  }

  registerCommands(context: vscode.ExtensionContext): void {
    this.extensionPath = context.extensionPath;
    context.subscriptions.push(
      vscode.commands.registerCommand('gemstone.upgradeWsl2', () => {
        const info = getWslInfo();
        const distro = info.defaultDistro ?? '';
        const terminal = vscode.window.createTerminal('GemStone: WSL Upgrade');
        terminal.show();
        terminal.sendText(`wsl --set-version ${distro} 2 && exit`);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) { disposable.dispose(); invalidateWslCache(); this.refresh(); }
        });
      }),
      vscode.commands.registerCommand('gemstone.runSetSharedMemory', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setSharedMemory.sh');
        const terminal = vscode.window.createTerminal('GemStone: Shared Memory Setup');
        terminal.show();
        terminal.sendText(`sudo "${scriptPath}" && exit`);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) { disposable.dispose(); this.refresh(); }
        });
      }),
      vscode.commands.registerCommand('gemstone.runSetSharedMemoryLinux', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setSharedMemoryLinux.sh');
        const terminal = this.createSetupTerminal('GemStone: Shared Memory Setup', scriptPath);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) { disposable.dispose(); this.refresh(); }
        });
      }),
      vscode.commands.registerCommand('gemstone.runSetRemoveIPC', () => {
        const scriptPath = path.join(this.extensionPath, 'resources', 'setRemoveIPC.sh');
        const terminal = this.createSetupTerminal('GemStone: RemoveIPC Setup', scriptPath);
        const disposable = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) { disposable.dispose(); this.refresh(); }
        });
      }),
      vscode.commands.registerCommand('gemstone.sharedMemoryInfo', () => {
        vscode.window.showInformationMessage(
          'Shared memory changes take effect immediately. No restart required.',
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
