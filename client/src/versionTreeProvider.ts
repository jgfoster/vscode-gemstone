import * as vscode from 'vscode';
import { GemStoneVersion } from './sysadminTypes';
import { VersionManager } from './versionManager';

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}

export class VersionItem extends vscode.TreeItem {
  constructor(public readonly version: GemStoneVersion) {
    super(version.version, vscode.TreeItemCollapsibleState.None);

    if (version.local) {
      this.description = `(local) | ${version.date}`;
      this.contextValue = 'gemstoneVersionLocal';
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.purple'));
      this.tooltip = version.buildDescription
        ? `${version.version} — local build\n${version.buildDescription}`
        : `${version.version} — local build`;
    } else {
      this.description = `${formatSize(version.size)} | ${version.date}`;

      let ctx = 'gemstoneVersion';
      if (version.downloaded) ctx += 'Downloaded';
      if (version.extracted) ctx += 'Extracted';
      this.contextValue = ctx;

      if (version.extracted) {
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        this.tooltip = `${version.version} — extracted and ready to use`;
      } else if (version.downloaded) {
        this.iconPath = new vscode.ThemeIcon('cloud-download');
        this.tooltip = `${version.version} — downloaded, not yet extracted`;
      } else {
        this.iconPath = new vscode.ThemeIcon('cloud');
        this.tooltip = `${version.version} — available for download`;
      }
    }
  }
}

export class VersionTreeProvider implements vscode.TreeDataProvider<VersionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<VersionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private versions: GemStoneVersion[] = [];
  private loading = false;

  constructor(private manager: VersionManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async loadVersions(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.versions = await this.manager.fetchAvailableVersions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to load versions: ${msg}`);
      this.versions = [];
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  getTreeItem(element: VersionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): VersionItem[] | Thenable<VersionItem[]> {
    if (this.versions.length === 0 && !this.loading) {
      // Trigger initial load
      this.loadVersions();
      return [];
    }
    return this.versions.map(v => new VersionItem(v));
  }
}
