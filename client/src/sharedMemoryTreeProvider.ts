import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';

type SharedMemoryNode =
  | { kind: 'status'; configured: boolean; gb: number }
  | { kind: 'action'; text: string; command: string };

export class SharedMemoryTreeProvider implements vscode.TreeDataProvider<SharedMemoryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SharedMemoryNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private extensionPath = '';

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  private getSharedMemory(): { shmmax: number; shmall: number } | undefined {
    try {
      const output = execSync('sysctl kern.sysv.shmmax kern.sysv.shmall', { encoding: 'utf-8' });
      const maxMatch = output.match(/kern\.sysv\.shmmax:\s*(\d+)/);
      const allMatch = output.match(/kern\.sysv\.shmall:\s*(\d+)/);
      if (!maxMatch || !allMatch) return undefined;
      return {
        shmmax: parseInt(maxMatch[1], 10),
        shmall: parseInt(allMatch[1], 10),
      };
    } catch {
      return undefined;
    }
  }

  getTreeItem(node: SharedMemoryNode): vscode.TreeItem {
    if (node.kind === 'status') {
      const item = new vscode.TreeItem(
        node.configured
          ? `Shared memory: ${node.gb} GB (configured)`
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
    // action node
    const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
    item.command = {
      command: node.command,
      title: node.text,
    };
    if (node.command === 'gemstone.runSetSharedMemory') {
      item.iconPath = new vscode.ThemeIcon('terminal');
      item.tooltip = 'Open a terminal and run the setup script with sudo';
    } else {
      item.iconPath = new vscode.ThemeIcon('info');
      item.tooltip = 'Restart required after running the script';
    }
    return item;
  }

  getChildren(node?: SharedMemoryNode): SharedMemoryNode[] {
    if (!node) {
      const mem = this.getSharedMemory();
      if (!mem) {
        return [{ kind: 'status', configured: false, gb: 0 }];
      }
      const shmmaxGb = mem.shmmax / Math.pow(2, 30);
      const shmallGb = mem.shmall / Math.pow(2, 18);
      const gb = Math.round(Math.min(shmmaxGb, shmallGb) * 10) / 10;
      const configured = shmmaxGb >= 4 && shmallGb >= 4;
      return [{ kind: 'status', configured, gb }];
    }
    if (node.kind === 'status' && !node.configured) {
      return [
        { kind: 'action', text: 'Run setup script (requires sudo)', command: 'gemstone.runSetSharedMemory' },
        { kind: 'action', text: 'Restart computer after running', command: 'gemstone.sharedMemoryInfo' },
      ];
    }
    return [];
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
      vscode.commands.registerCommand('gemstone.sharedMemoryInfo', () => {
        vscode.window.showInformationMessage(
          'After running the setup script, restart your computer for the shared memory changes to take effect.',
        );
      }),
    );
  }
}
