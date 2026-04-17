import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseYaml, GemStoneDatabase } from './sysadminTypes';
import { needsWsl, getWslInfo, wslPathToWindows, windowsPathToWsl } from './wslBridge';

export class SysadminStorage {
  getRootPath(): string {
    const config = vscode.workspace.getConfiguration('gemstone');
    const raw = config.get<string>('rootPath', '~/Documents/GemStone');
    if (needsWsl()) {
      const wslHome = getWslInfo().homeDir || '/root';
      return wslPathToWindows(raw.replace(/^~/, wslHome));
    }
    return raw.replace(/^~/, os.homedir());
  }

  /** Get the root path as a WSL Linux path (for use in WSL commands) */
  getWslRootPath(): string {
    if (!needsWsl()) return this.getRootPath();
    const config = vscode.workspace.getConfiguration('gemstone');
    const raw = config.get<string>('rootPath', '~/Documents/GemStone');
    const wslHome = getWslInfo().homeDir || '/root';
    return raw.replace(/^~/, wslHome);
  }

  ensureRootPath(): void {
    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath, { recursive: true });
    }
    const locksDir = path.join(rootPath, 'locks');
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true });
    }
  }

  /** Returns the platform key for downloads, e.g. "arm64.Darwin" */
  getPlatformKey(): string | undefined {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    if (process.platform === 'darwin') return `${arch}.Darwin`;
    if (process.platform === 'linux') return `${arch}.Linux`;
    if (needsWsl() && getWslInfo().available) return `${arch}.Linux`;
    return undefined;
  }

  /** Returns the file extension for downloads on this platform */
  getDownloadExtension(): string {
    return process.platform === 'darwin' ? 'dmg' : 'zip';
  }

  /** Returns the product directory suffix, e.g. "-arm64.Darwin" */
  getPlatformSuffix(): string {
    return `-${this.getPlatformKey()}`;
  }

  /** Get the GEMSTONE path for a given version */
  getGemstonePath(version: string): string | undefined {
    const suffix = this.getPlatformSuffix();
    const dir = path.join(this.getRootPath(), `GemStone64Bit${version}${suffix}`);
    return fs.existsSync(dir) ? dir : undefined;
  }

  /** Get the GEMSTONE path as a WSL Linux path (for use in WSL commands) */
  getWslGemstonePath(version: string): string | undefined {
    if (!needsWsl()) return this.getGemstonePath(version);
    // Check existence via the UNC path
    if (!this.getGemstonePath(version)) return undefined;
    const suffix = this.getPlatformSuffix();
    return `${this.getWslRootPath()}/GemStone64Bit${version}${suffix}`;
  }

  /** Scan for db-* directories containing database.yaml */
  getDatabases(): GemStoneDatabase[] {
    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) return [];
    const databases: GemStoneDatabase[] = [];
    for (const entry of fs.readdirSync(rootPath)) {
      if (!entry.startsWith('db-')) continue;
      const dbPath = path.join(rootPath, entry);
      const stat = fs.statSync(dbPath);
      if (!stat.isDirectory()) continue;
      const config = this.readDatabaseYaml(dbPath);
      if (config) {
        databases.push({ dirName: entry, path: dbPath, config });
      }
    }
    databases.sort((a, b) => a.dirName.localeCompare(b.dirName, undefined, { numeric: true }));
    return databases;
  }

  readDatabaseYaml(dbPath: string): DatabaseYaml | undefined {
    const yamlPath = path.join(dbPath, 'database.yaml');
    if (!fs.existsSync(yamlPath)) return undefined;
    const content = fs.readFileSync(yamlPath, 'utf-8');
    // Simple YAML parser for our known format
    const version = content.match(/^version:\s*"?([^"\n]+)"?/m)?.[1];
    const stoneName = content.match(/^stoneName:\s*"?([^"\n]+)"?/m)?.[1];
    const ldiName = content.match(/^ldiName:\s*"?([^"\n]+)"?/m)?.[1];
    const baseExtent = content.match(/^baseExtent:\s*"?([^"\n]+)"?/m)?.[1];
    if (!version || !stoneName || !ldiName || !baseExtent) return undefined;
    return { version, stoneName, ldiName, baseExtent };
  }

  /** Get the next available db-N number */
  getNextDbNumber(): number {
    const rootPath = this.getRootPath();
    let i = 1;
    while (fs.existsSync(path.join(rootPath, `db-${i}`))) {
      i++;
    }
    return i;
  }

  /** Get extracted version directory names as version strings */
  getExtractedVersions(): string[] {
    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) return [];
    const suffix = this.getPlatformSuffix();
    const prefix = 'GemStone64Bit';
    const versions: string[] = [];
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
        const dirPath = path.join(rootPath, entry);
        if (fs.statSync(dirPath).isDirectory()) {
          const version = entry.slice(prefix.length, -suffix.length);
          versions.push(version);
        }
      }
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
  }

  /** Check if an extracted version directory is a symlink (local version) */
  isLocalVersion(version: string): boolean {
    const suffix = this.getPlatformSuffix();
    const dir = path.join(this.getRootPath(), `GemStone64Bit${version}${suffix}`);
    try {
      return fs.lstatSync(dir).isSymbolicLink();
    } catch {
      return false;
    }
  }

  /** Read version.txt from a product directory, returns { version, date, description } */
  static readVersionTxt(productPath: string): { version: string; date: string; description: string } | undefined {
    const versionFile = path.join(productPath, 'version.txt');
    if (!fs.existsSync(versionFile)) return undefined;
    const lines = fs.readFileSync(versionFile, 'utf-8').trim().split('\n');
    if (lines.length < 2) return undefined;
    // Line 2: "3.7.6 Build: 2026-03-24T16:26:18-07:00 ..."
    const match = lines[1].match(/^(\S+)\s+Build:\s+(\S+)/);
    if (!match) return undefined;
    const version = match[1];
    const buildDate = match[2].split('T')[0]; // just the date portion
    const description = lines.length >= 3 ? lines[2].trim() : '';
    return { version, date: buildDate, description };
  }

  /** Get available .dbf extent files from a version's bin/ directory */
  getAvailableExtents(version: string): string[] {
    const gsPath = this.getGemstonePath(version);
    if (!gsPath) return [];
    const binDir = path.join(gsPath, 'bin');
    if (!fs.existsSync(binDir)) return [];
    const extents: string[] = [];
    for (const entry of fs.readdirSync(binDir)) {
      if (entry.endsWith('.dbf')) {
        extents.push(entry.slice(0, -4)); // remove .dbf extension
      }
    }
    extents.sort();
    return extents;
  }

  // ── Windows client distribution helpers ────────────────────

  /** Root path resolved via native os.homedir() (no WSL translation) */
  getNativeRootPath(): string {
    const config = vscode.workspace.getConfiguration('gemstone');
    const raw = config.get<string>('rootPath', '~/Documents/GemStone');
    return raw.replace(/^~/, os.homedir());
  }

  /** Ensure the native root directory exists (for Windows client downloads) */
  ensureNativeRootPath(): void {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath, { recursive: true });
    }
  }

  private static readonly WIN_CLIENT_SUFFIX = '-x86.Windows_NT';
  private static readonly WIN_CLIENT_PREFIX = 'GemStone64BitClient';

  /** Get the extracted Windows client directory for a version */
  getWindowsClientPath(version: string): string | undefined {
    const dir = path.join(
      this.getNativeRootPath(),
      `${SysadminStorage.WIN_CLIENT_PREFIX}${version}${SysadminStorage.WIN_CLIENT_SUFFIX}`,
    );
    return fs.existsSync(dir) ? dir : undefined;
  }

  /** Get the GCI DLL path from an extracted Windows client */
  getWindowsClientGciPath(version: string): string | undefined {
    const clientPath = this.getWindowsClientPath(version);
    if (!clientPath) return undefined;
    // Windows client distributions place DLLs in bin/, not lib/
    const dllPath = path.join(clientPath, 'bin', `libgcits-${version}-64.dll`);
    return fs.existsSync(dllPath) ? dllPath : undefined;
  }

  /** Scan for extracted Windows client version directories */
  getExtractedWindowsClientVersions(): string[] {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) return [];
    const prefix = SysadminStorage.WIN_CLIENT_PREFIX;
    const suffix = SysadminStorage.WIN_CLIENT_SUFFIX;
    const versions: string[] = [];
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
        const dirPath = path.join(rootPath, entry);
        if (fs.statSync(dirPath).isDirectory()) {
          const version = entry.slice(prefix.length, -suffix.length);
          versions.push(version);
        }
      }
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
  }

  /** Get downloaded Windows client zip files */
  getDownloadedWindowsClientFiles(): Map<string, number> {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) return new Map();
    const prefix = SysadminStorage.WIN_CLIENT_PREFIX;
    const suffix = SysadminStorage.WIN_CLIENT_SUFFIX;
    const files = new Map<string, number>();
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(`${suffix}.zip`)) {
        const filePath = path.join(rootPath, entry);
        if (fs.statSync(filePath).isFile()) {
          const version = entry.slice(prefix.length, -(suffix.length + 4));
          files.set(version, fs.statSync(filePath).size);
        }
      }
    }
    return files;
  }

  /** Get downloaded files in the root path */
  getDownloadedFiles(): Map<string, number> {
    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) return new Map();
    const ext = this.getDownloadExtension();
    const suffix = this.getPlatformSuffix();
    const prefix = 'GemStone64Bit';
    const files = new Map<string, number>();
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(`${suffix}.${ext}`)) {
        const filePath = path.join(rootPath, entry);
        if (fs.statSync(filePath).isFile()) {
          const version = entry.slice(prefix.length, -(suffix.length + ext.length + 1));
          files.set(version, fs.statSync(filePath).size);
        }
      }
    }
    return files;
  }
}
