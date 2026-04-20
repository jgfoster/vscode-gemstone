import * as vscode from 'vscode';
import { GemStoneVersion } from './sysadminTypes';
import { VersionManager } from './versionManager';
import { isWindows, getWslInfo } from './wslBridge';

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}

/**
 * True when server management isn't available in this session — the Versions
 * view reduces to a Windows-client-only catalog. The row icon then reflects
 * client state instead of server state.
 */
function isClientOnlyMode(): boolean {
  return isWindows() && !getWslInfo().available;
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
      return;
    }

    const clientOnly = isClientOnlyMode();
    const sizeLabel = version.size > 0 ? formatSize(version.size) : '';
    this.description = [sizeLabel, version.date].filter(Boolean).join(' | ');

    // Independent flag suffixes so `when` clauses can match each state with a
    // simple substring regex (e.g. /ServerExtracted/) without worrying about
    // cross-state overlap.
    let ctx = 'gemstoneVersion';
    if (version.downloaded) ctx += 'ServerDownloaded';
    if (version.extracted) ctx += 'ServerExtracted';
    if (version.clientExtracted) ctx += 'ClientExtracted';
    this.contextValue = ctx;

    const tooltipBits: string[] = [version.version];
    if (clientOnly) {
      // Windows-no-WSL: icon reflects Windows-client state only.
      if (version.clientExtracted) {
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        tooltipBits.push('Windows client extracted');
      } else {
        this.iconPath = new vscode.ThemeIcon('cloud');
        tooltipBits.push('Windows client available for download');
      }
    } else {
      // Server state drives the primary icon.
      if (version.extracted) {
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        tooltipBits.push('extracted and ready to use');
      } else if (version.downloaded) {
        this.iconPath = new vscode.ThemeIcon('cloud-download');
        tooltipBits.push('downloaded, not yet extracted');
      } else {
        this.iconPath = new vscode.ThemeIcon('cloud');
        tooltipBits.push('available for download');
      }
      if (isWindows() && version.clientExtracted) {
        tooltipBits.push('Windows client extracted');
      }
    }
    this.tooltip = tooltipBits.join(' — ');
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
