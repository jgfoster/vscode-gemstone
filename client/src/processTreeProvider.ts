import * as vscode from 'vscode';
import { ProcessManager } from './processManager';
import { GemStoneProcess } from './sysadminTypes';
import {
  needsWsl,
  getWslNetworkInfoCached,
  refreshWslNetworkInfo,
  WslNetworkInfo,
} from './wslBridge';

export class ProcessItem extends vscode.TreeItem {
  constructor(
    public readonly process: GemStoneProcess,
    wslNetwork?: WslNetworkInfo,
  ) {
    super(process.name, vscode.TreeItemCollapsibleState.None);
    const portInfo = process.port ? ` port ${process.port}` : '';
    this.description = `${process.version} | PID ${process.pid}${portInfo}`;
    let tooltip = `${process.type === 'stone' ? 'Stone' : 'NetLDI'}: ${process.name}\n` +
      `Version: ${process.version}\nPID: ${process.pid}` +
      (process.port ? `\nPort: ${process.port}` : '') +
      (process.startTime ? `\nStarted: ${process.startTime}` : '');
    // NetLDI-only reachability hint for Windows+WSL. Under mirrored
    // networking `localhost` works; otherwise we surface the WSL IP so
    // users can paste it into Login Parameters.
    if (process.type === 'netldi' && wslNetwork) {
      if (wslNetwork.mirrored) {
        tooltip += '\nHost: localhost (WSL mirrored networking)';
      } else if (wslNetwork.ip) {
        tooltip += `\nHost: ${wslNetwork.ip} (WSL — may change on reboot)`;
      }
    }
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon(
      process.type === 'stone' ? 'database' : 'radio-tower',
      new vscode.ThemeColor('testing.iconPassed'),
    );
    this.contextValue = `gemstoneProcess${process.type === 'stone' ? 'Stone' : 'Netldi'}`;
  }
}

export class ProcessTreeProvider implements vscode.TreeDataProvider<ProcessItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProcessItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private networkRefreshInFlight = false;

  constructor(private processManager: ProcessManager) {}

  refresh(): void {
    this.processManager.refreshProcesses();
    // WSL IP is unstable across restarts, so re-probe alongside each
    // gslist refresh. Fire-and-forget: the tree renders whatever was
    // cached last, and re-renders when the probe lands.
    this.scheduleWslNetworkRefresh();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProcessItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ProcessItem[] {
    const wslNet = needsWsl() ? getWslNetworkInfoCached() : undefined;
    if (needsWsl() && !wslNet) this.scheduleWslNetworkRefresh();
    return this.processManager.getProcesses().map(p => new ProcessItem(p, wslNet));
  }

  private scheduleWslNetworkRefresh(): void {
    if (!needsWsl() || this.networkRefreshInFlight) return;
    this.networkRefreshInFlight = true;
    refreshWslNetworkInfo()
      .finally(() => { this.networkRefreshInFlight = false; })
      .then(() => this._onDidChangeTreeData.fire(undefined))
      .catch(() => { /* already swallowed in refreshWslNetworkInfo */ });
  }
}
