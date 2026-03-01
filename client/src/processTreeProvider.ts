import * as vscode from 'vscode';
import { ProcessManager } from './processManager';
import { GemStoneProcess } from './sysadminTypes';

export class ProcessItem extends vscode.TreeItem {
  constructor(public readonly process: GemStoneProcess) {
    super(process.name, vscode.TreeItemCollapsibleState.None);
    const portInfo = process.port ? ` port ${process.port}` : '';
    this.description = `${process.version} | PID ${process.pid}${portInfo}`;
    this.tooltip = `${process.type === 'stone' ? 'Stone' : 'NetLDI'}: ${process.name}\n` +
      `Version: ${process.version}\nPID: ${process.pid}` +
      (process.port ? `\nPort: ${process.port}` : '') +
      (process.startTime ? `\nStarted: ${process.startTime}` : '');
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

  constructor(private processManager: ProcessManager) {}

  refresh(): void {
    this.processManager.refreshProcesses();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProcessItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ProcessItem[] {
    return this.processManager.getProcesses().map(p => new ProcessItem(p));
  }
}
