import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', () => ({
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
}));
vi.mock('child_process');

import { execSync } from 'child_process';

import { __setConfig, __resetConfig } from '../__mocks__/vscode';
import { SysadminStorage } from '../sysadminStorage';
import { VersionManager } from '../versionManager';
import { GemStoneVersion } from '../sysadminTypes';

// ── Helpers ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  __resetConfig();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-winclient-'));
  __setConfig('gemstone', 'rootPath', tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createWindowsClientDir(version: string): string {
  const dirName = `GemStone64BitClient${version}-x86.Windows_NT`;
  const dirPath = path.join(tmpDir, dirName);
  fs.mkdirSync(dirPath);
  return dirPath;
}

function createWindowsClientWithLib(version: string): string {
  const dirPath = createWindowsClientDir(version);
  // Windows client distributions place DLLs in bin/, not lib/
  const binDir = path.join(dirPath, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, `libgcits-${version}-64.dll`), '');
  return dirPath;
}

function createWindowsClientZip(version: string, size: number = 1000): void {
  const fileName = `GemStone64BitClient${version}-x86.Windows_NT.zip`;
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, Buffer.alloc(size));
}

// ── SysadminStorage.getNativeRootPath ─────────────────────

describe('SysadminStorage.getNativeRootPath', () => {
  it('resolves ~ via os.homedir() not WSL', () => {
    __setConfig('gemstone', 'rootPath', '~/Documents/GemStone');
    const storage = new SysadminStorage();
    const result = storage.getNativeRootPath();
    // The config uses forward slashes; getNativeRootPath does string replacement
    expect(result).toBe(os.homedir() + '/Documents/GemStone');
    expect(result).not.toContain('wsl');
  });

  it('uses configured rootPath when absolute', () => {
    const storage = new SysadminStorage();
    // tmpDir is set as rootPath in beforeEach
    expect(storage.getNativeRootPath()).toBe(tmpDir);
  });
});

// ── SysadminStorage.ensureNativeRootPath ───────────────────

describe('SysadminStorage.ensureNativeRootPath', () => {
  it('creates the directory if it does not exist', () => {
    const newDir = path.join(tmpDir, 'nested', 'path');
    __setConfig('gemstone', 'rootPath', newDir);
    const storage = new SysadminStorage();
    expect(fs.existsSync(newDir)).toBe(false);
    storage.ensureNativeRootPath();
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('does nothing if directory already exists', () => {
    const storage = new SysadminStorage();
    storage.ensureNativeRootPath();
    expect(fs.existsSync(tmpDir)).toBe(true);
  });
});

// ── SysadminStorage.getWindowsClientPath ──────────────────

describe('SysadminStorage.getWindowsClientPath', () => {
  it('returns path when client directory exists', () => {
    const dirPath = createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientPath('3.7.5')).toBe(dirPath);
  });

  it('returns undefined when client directory does not exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientPath('9.9.9')).toBeUndefined();
  });
});

// ── SysadminStorage.getWindowsClientGciPath ───────────────

describe('SysadminStorage.getWindowsClientGciPath', () => {
  it('returns DLL path from bin/ directory (not lib/)', () => {
    createWindowsClientWithLib('3.7.5');
    const storage = new SysadminStorage();
    const result = storage.getWindowsClientGciPath('3.7.5');
    expect(result).toBeDefined();
    expect(result).toContain(path.join('bin', 'libgcits-3.7.5-64.dll'));
  });

  it('does not look in lib/ for the DLL', () => {
    // Windows client distributions put DLLs in bin/, not lib/.
    // A lib/ directory with a DLL should NOT be found.
    const dirPath = createWindowsClientDir('3.7.5');
    const libDir = path.join(dirPath, 'lib');
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(libDir, 'libgcits-3.7.5-64.dll'), '');
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientGciPath('3.7.5')).toBeUndefined();
  });

  it('returns undefined when client directory exists without bin', () => {
    createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientGciPath('3.7.5')).toBeUndefined();
  });

  it('returns undefined when client directory does not exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientGciPath('9.9.9')).toBeUndefined();
  });
});

// ── SysadminStorage.getExtractedWindowsClientVersions ─────

describe('SysadminStorage.getExtractedWindowsClientVersions', () => {
  it('returns empty array when no client directories exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getExtractedWindowsClientVersions()).toEqual([]);
  });

  it('finds extracted client versions', () => {
    createWindowsClientDir('3.7.5');
    createWindowsClientDir('3.6.4');
    const storage = new SysadminStorage();
    const versions = storage.getExtractedWindowsClientVersions();
    expect(versions).toEqual(['3.7.5', '3.6.4']); // sorted newest first
  });

  it('ignores non-client directories', () => {
    createWindowsClientDir('3.7.5');
    fs.mkdirSync(path.join(tmpDir, 'GemStone64Bit3.7.5-x86_64.Linux'));
    const storage = new SysadminStorage();
    const versions = storage.getExtractedWindowsClientVersions();
    expect(versions).toEqual(['3.7.5']);
  });

  it('ignores zip files (not extracted)', () => {
    createWindowsClientZip('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getExtractedWindowsClientVersions()).toEqual([]);
  });
});

// ── SysadminStorage.getDownloadedWindowsClientFiles ───────

describe('SysadminStorage.getDownloadedWindowsClientFiles', () => {
  it('returns empty map when no zip files exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getDownloadedWindowsClientFiles().size).toBe(0);
  });

  it('finds downloaded zip files with sizes', () => {
    createWindowsClientZip('3.7.5', 5000);
    createWindowsClientZip('3.6.4', 3000);
    const storage = new SysadminStorage();
    const files = storage.getDownloadedWindowsClientFiles();
    expect(files.size).toBe(2);
    expect(files.get('3.7.5')).toBe(5000);
    expect(files.get('3.6.4')).toBe(3000);
  });

  it('ignores extracted directories', () => {
    createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getDownloadedWindowsClientFiles().size).toBe(0);
  });
});

// ── VersionManager.fetchAvailableWindowsClientVersions ────

describe('VersionManager.fetchAvailableWindowsClientVersions', () => {
  it('parses version directories from HTML listing', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const html = `
      <a href="3.7.5/">3.7.5/</a>  12-Mar-2026 10:00  -
      <a href="3.6.4/">3.6.4/</a>  06-Jun-2022 10:00  -
      <a href="3.7.4.3/">3.7.4.3/</a>  15-Jan-2025 10:00  -
    `;
    vi.spyOn(manager as any, 'fetchUrl').mockResolvedValue(html);

    const versions = await manager.fetchAvailableWindowsClientVersions();
    expect(versions.length).toBe(3);
    expect(versions[0].version).toBe('3.7.5');
    expect(versions[1].version).toBe('3.7.4.3');
    expect(versions[2].version).toBe('3.6.4');
  });

  it('constructs correct download URLs', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const html = '<a href="3.7.5/">3.7.5/</a>';
    vi.spyOn(manager as any, 'fetchUrl').mockResolvedValue(html);

    const versions = await manager.fetchAvailableWindowsClientVersions();
    expect(versions[0].url).toBe(
      'https://downloads.gemtalksystems.com/pub/GemStone64/3.7.5/GemStone64BitClient3.7.5-x86.Windows_NT.zip',
    );
    expect(versions[0].fileName).toBe('GemStone64BitClient3.7.5-x86.Windows_NT.zip');
  });

  it('marks versions as downloaded when zip exists locally', async () => {
    createWindowsClientZip('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const html = '<a href="3.7.5/">3.7.5/</a>';
    vi.spyOn(manager as any, 'fetchUrl').mockResolvedValue(html);

    const versions = await manager.fetchAvailableWindowsClientVersions();
    expect(versions[0].downloaded).toBe(true);
    expect(versions[0].extracted).toBe(false);
  });

  it('marks versions as extracted when client directory exists', async () => {
    createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const html = '<a href="3.7.5/">3.7.5/</a>';
    vi.spyOn(manager as any, 'fetchUrl').mockResolvedValue(html);

    const versions = await manager.fetchAvailableWindowsClientVersions();
    expect(versions[0].extracted).toBe(true);
  });

  it('returns empty array when no version directories found', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    vi.spyOn(manager as any, 'fetchUrl').mockResolvedValue('<html>no versions here</html>');

    const versions = await manager.fetchAvailableWindowsClientVersions();
    expect(versions).toEqual([]);
  });

  it('sorts versions newest first', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const html = '<a href="3.6.4/">3.6.4/</a>\n<a href="3.7.5/">3.7.5/</a>\n<a href="3.7.4/">3.7.4/</a>';
    vi.spyOn(manager as any, 'fetchUrl').mockResolvedValue(html);

    const versions = await manager.fetchAvailableWindowsClientVersions();
    expect(versions.map(v => v.version)).toEqual(['3.7.5', '3.7.4', '3.6.4']);
  });
});

// ── VersionManager.deleteWindowsClientDownload ────────────

describe('VersionManager.deleteWindowsClientDownload', () => {
  it('removes the zip file', async () => {
    createWindowsClientZip('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const version: GemStoneVersion = {
      version: '3.7.5',
      fileName: 'GemStone64BitClient3.7.5-x86.Windows_NT.zip',
      url: '', size: 0, date: '', downloaded: true, extracted: false,
    };
    await manager.deleteWindowsClientDownload(version);
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  it('does nothing when zip does not exist', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const version: GemStoneVersion = {
      version: '9.9.9',
      fileName: 'GemStone64BitClient9.9.9-x86.Windows_NT.zip',
      url: '', size: 0, date: '', downloaded: false, extracted: false,
    };
    await manager.deleteWindowsClientDownload(version); // should not throw
  });
});

// ── VersionManager.deleteWindowsClientExtracted ───────────

describe('VersionManager.deleteWindowsClientExtracted', () => {
  it('removes the extracted client directory', async () => {
    const dirPath = createWindowsClientWithLib('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    expect(fs.existsSync(dirPath)).toBe(true);

    const version: GemStoneVersion = {
      version: '3.7.5',
      fileName: '', url: '', size: 0, date: '', downloaded: false, extracted: true,
    };
    await manager.deleteWindowsClientExtracted(version);
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('does nothing when directory does not exist', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const version: GemStoneVersion = {
      version: '9.9.9',
      fileName: '', url: '', size: 0, date: '', downloaded: false, extracted: false,
    };
    await manager.deleteWindowsClientExtracted(version); // should not throw
  });
});

// ── VersionManager.extractWindowsClient ───────────────────

describe('VersionManager.extractWindowsClient', () => {
  it('uses tar for extraction, not PowerShell', async () => {
    createWindowsClientZip('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const version: GemStoneVersion = {
      version: '3.7.5',
      fileName: 'GemStone64BitClient3.7.5-x86.Windows_NT.zip',
      url: '', size: 0, date: '', downloaded: true, extracted: false,
    };
    const progress = { report: vi.fn() };
    await manager.extractWindowsClient(version, progress);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('tar -xf'),
      expect.anything(),
    );
    // Ensure we don't use PowerShell (which can be blocked by execution policy)
    const calls = vi.mocked(execSync).mock.calls;
    for (const call of calls) {
      expect(String(call[0]).toLowerCase()).not.toContain('powershell');
    }
  });

  it('reports progress', async () => {
    createWindowsClientZip('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const version: GemStoneVersion = {
      version: '3.7.5',
      fileName: 'GemStone64BitClient3.7.5-x86.Windows_NT.zip',
      url: '', size: 0, date: '', downloaded: true, extracted: false,
    };
    const progress = { report: vi.fn() };
    await manager.extractWindowsClient(version, progress);

    expect(progress.report).toHaveBeenCalledWith({ message: 'Extracting zip...' });
  });
});
