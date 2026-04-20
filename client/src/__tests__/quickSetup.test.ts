import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('fs');
vi.mock('child_process');

import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { runQuickSetup, QuickSetupDeps } from '../quickSetup';
import { GemStoneVersion } from '../sysadminTypes';

// ── Helpers ────────────────────────────────────────────────

const SHMMAX_1GB = 1073741824;
const SHMALL_1GB = 262144;

function mockSharedMemory(shmmax: number, shmall: number): void {
  const output = process.platform === 'linux'
    ? `kernel.shmmax = ${shmmax}\nkernel.shmall = ${shmall}\n`
    : `kern.sysv.shmmax: ${shmmax}\nkern.sysv.shmall: ${shmall}\n`;
  vi.mocked(exec as any).mockImplementation((_cmd: any, _opts: any, cb: any) => {
    cb(null, output, '');
  });
}

function mockSharedMemorySmall(): void {
  mockSharedMemory(4194304, 1024); // 4 MB
}

function makeVersion(overrides?: Partial<GemStoneVersion>): GemStoneVersion {
  return {
    version: '3.7.4',
    fileName: 'GemStone64Bit3.7.4-arm64.Darwin.dmg',
    url: 'https://example.com/GemStone64Bit3.7.4-arm64.Darwin.dmg',
    size: 100000,
    date: '01-Jan-2026',
    downloaded: false,
    extracted: false,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<QuickSetupDeps>): QuickSetupDeps {
  return {
    sysadminStorage: {
      getGemstonePath: vi.fn(() => '/gs'),
      getRootPath: vi.fn(() => '/root'),
      getNextDbNumber: vi.fn(() => 1),
      ensureRootPath: vi.fn(),
      getExtractedVersions: vi.fn(() => []),
      getAvailableExtents: vi.fn(() => ['extent0']),
      getPlatformSuffix: vi.fn(() => '-arm64.Darwin'),
      getWindowsClientGciPath: vi.fn(() => undefined),
    } as any,
    versionManager: {
      fetchAvailableVersions: vi.fn(async () => [makeVersion()]),
      download: vi.fn(async () => {}),
      extract: vi.fn(async () => {}),
      downloadAndExtractWindowsClient: vi.fn(async () => {}),
    } as any,
    databaseManager: {
      createDatabaseDirect: vi.fn(async () => ({
        dirName: 'db-1',
        path: '/root/db-1',
        config: { version: '3.7.4', stoneName: 'gs64stone', ldiName: 'gs64ldi', baseExtent: 'extent0.dbf' },
      })),
    } as any,
    processManager: {
      startStone: vi.fn(async () => 'started'),
      startNetldi: vi.fn(async () => 'started'),
      refreshProcesses: vi.fn(),
    } as any,
    loginStorage: {
      saveLogin: vi.fn(async () => {}),
      setGciLibraryPath: vi.fn(async () => {}),
    } as any,
    refreshAdminViews: vi.fn(),
    refreshVersions: vi.fn(),
    refreshLogins: vi.fn(),
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────

describe('runQuickSetup', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = process.platform;
    setPlatform('darwin');
    mockSharedMemory(SHMMAX_1GB, SHMALL_1GB);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version: makeVersion() } as any);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  // ── Shared memory ─────────────────────────────────────────

  it('skips shared memory check on Windows', async () => {
    setPlatform('win32');
    const deps = makeDeps();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version: makeVersion({ extracted: true }) } as any);
    await runQuickSetup(deps);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.loginStorage.saveLogin).toHaveBeenCalled();
  });

  it('warns when shared memory is too low', async () => {
    mockSharedMemorySmall();
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as any); // cancelled
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not configured'),
      expect.anything(),
      'Run Setup Script',
      'Skip',
    );
    // Cancelled — should not proceed
    expect(deps.versionManager.fetchAvailableVersions).not.toHaveBeenCalled();
  });

  it('proceeds when shared memory is low and user clicks Skip', async () => {
    mockSharedMemorySmall();
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Skip' as any);
    const deps = makeDeps();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version: makeVersion({ extracted: true }) } as any);
    await runQuickSetup(deps);
    expect(deps.loginStorage.saveLogin).toHaveBeenCalled();
  });

  it('runs setup script and restarts Quick Setup after terminal closes', async () => {
    // First call: memory is low → user clicks "Run Setup Script"
    // Second call (after terminal closes): memory is now OK → proceeds
    let callCount = 0;
    vi.mocked(exec as any).mockImplementation((_cmd: any, _opts: any, cb: any) => {
      callCount++;
      if (callCount <= 1) {
        // First check: memory too small
        const output = process.platform === 'linux'
          ? 'kernel.shmmax = 4194304\nkernel.shmall = 1024\n'
          : 'kern.sysv.shmmax: 4194304\nkern.sysv.shmall: 1024\n';
        cb(null, output, '');
      } else {
        // After script ran: memory is now configured
        const output = process.platform === 'linux'
          ? `kernel.shmmax = ${SHMMAX_1GB}\nkernel.shmall = ${SHMALL_1GB}\n`
          : `kern.sysv.shmmax: ${SHMMAX_1GB}\nkern.sysv.shmall: ${SHMALL_1GB}\n`;
        cb(null, output, '');
      }
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Run Setup Script' as any);

    // Simulate terminal close when onDidCloseTerminal is registered
    vi.mocked(vscode.window.onDidCloseTerminal).mockImplementation((handler: any) => {
      setTimeout(() => handler({ name: 'GemStone: Shared Memory Setup' }), 0);
      return { dispose: vi.fn() };
    });

    const deps = makeDeps();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version: makeVersion({ extracted: true }) } as any);
    await runQuickSetup(deps);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetSharedMemory');
    // Should have continued and completed setup after restart
    expect(deps.loginStorage.saveLogin).toHaveBeenCalled();
  });

  // ── Version selection ─────────────────────────────────────

  it('returns early if version picker is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.versionManager.download).not.toHaveBeenCalled();
  });

  it('shows error if no versions are available', async () => {
    const deps = makeDeps({
      versionManager: { fetchAvailableVersions: vi.fn(async () => []), download: vi.fn(), extract: vi.fn() } as any,
    });
    await runQuickSetup(deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('No GemStone versions'));
  });

  // ── Download and extract ──────────────────────────────────

  it('downloads and extracts when version is not yet available', async () => {
    const version = makeVersion({ downloaded: false, extracted: false });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.versionManager.download).toHaveBeenCalled();
    expect(deps.versionManager.extract).toHaveBeenCalled();
  });

  it('skips download when version is already downloaded', async () => {
    const version = makeVersion({ downloaded: true, extracted: false });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.versionManager.download).not.toHaveBeenCalled();
    expect(deps.versionManager.extract).toHaveBeenCalled();
  });

  it('skips download and extract when version is already extracted', async () => {
    const version = makeVersion({ downloaded: true, extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.versionManager.download).not.toHaveBeenCalled();
    expect(deps.versionManager.extract).not.toHaveBeenCalled();
  });

  it('stops if download fails', async () => {
    const version = makeVersion();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps({
      versionManager: {
        fetchAvailableVersions: vi.fn(async () => [version]),
        download: vi.fn(async () => { throw new Error('network error'); }),
        extract: vi.fn(),
      } as any,
    });
    await runQuickSetup(deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('network error'));
    expect(deps.databaseManager.createDatabaseDirect).not.toHaveBeenCalled();
  });

  it('stops if extraction fails', async () => {
    const version = makeVersion({ downloaded: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps({
      versionManager: {
        fetchAvailableVersions: vi.fn(async () => [version]),
        download: vi.fn(),
        extract: vi.fn(async () => { throw new Error('disk full'); }),
      } as any,
    });
    await runQuickSetup(deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    expect(deps.databaseManager.createDatabaseDirect).not.toHaveBeenCalled();
  });

  // ── Database, stone, netldi ───────────────────────────────

  it('creates database with default names', async () => {
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.databaseManager.createDatabaseDirect).toHaveBeenCalledWith(
      '3.7.4', 'extent0', 'gs64stone', 'gs64ldi', expect.anything(),
    );
  });

  it('starts stone and NetLDI after creating database', async () => {
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.processManager.startStone).toHaveBeenCalled();
    expect(deps.processManager.startNetldi).toHaveBeenCalled();
  });

  it('stops if stone start fails', async () => {
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps({
      processManager: {
        startStone: vi.fn(async () => { throw new Error('stone failed'); }),
        startNetldi: vi.fn(),
        refreshProcesses: vi.fn(),
      } as any,
    });
    await runQuickSetup(deps);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('stone failed'));
    expect(deps.processManager.startNetldi).not.toHaveBeenCalled();
  });

  // ── Login creation ────────────────────────────────────────

  it('saves a login with correct defaults', async () => {
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.loginStorage.saveLogin).toHaveBeenCalledWith(expect.objectContaining({
      version: '3.7.4',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: 'swordfish',
      netldi: 'gs64ldi',
    }));
  });

  it('sets GCI library path on non-Windows platforms', async () => {
    setPlatform('darwin');
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.loginStorage.setGciLibraryPath).toHaveBeenCalledWith(
      '3.7.4',
      expect.stringContaining('libgcits-3.7.4-64.dylib'),
    );
  });

  // ── Refresh and completion ────────────────────────────────

  it('refreshes all views and shows success message', async () => {
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.refreshAdminViews).toHaveBeenCalled();
    expect(deps.refreshLogins).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Quick Setup complete'),
    );
  });

  // ── Windows client download ──────────────────────────────

  it('installs Windows client and sets GCI library on Windows', async () => {
    setPlatform('win32');
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    vi.mocked(deps.sysadminStorage.getWindowsClientGciPath as any).mockReturnValue('/native/lib/libgcits-3.7.4-64.dll');
    await runQuickSetup(deps);
    expect(deps.versionManager.downloadAndExtractWindowsClient).toHaveBeenCalled();
    expect(deps.loginStorage.setGciLibraryPath).toHaveBeenCalledWith(
      '3.7.4',
      '/native/lib/libgcits-3.7.4-64.dll',
    );
  });

  it('continues setup even if Windows client install fails', async () => {
    setPlatform('win32');
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps({
      versionManager: {
        fetchAvailableVersions: vi.fn(async () => [version]),
        download: vi.fn(async () => {}),
        extract: vi.fn(async () => {}),
        downloadAndExtractWindowsClient: vi.fn(async () => { throw new Error('network error'); }),
      } as any,
    });
    await runQuickSetup(deps);
    // Should still complete setup despite Windows client install failure
    expect(deps.loginStorage.saveLogin).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Quick Setup complete'),
    );
  });

  it('does not install Windows client on non-Windows platforms', async () => {
    setPlatform('darwin');
    const version = makeVersion({ extracted: true });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.4', version } as any);
    const deps = makeDeps();
    await runQuickSetup(deps);
    expect(deps.versionManager.downloadAndExtractWindowsClient).not.toHaveBeenCalled();
    expect(deps.loginStorage.setGciLibraryPath).toHaveBeenCalledWith(
      '3.7.4',
      expect.stringContaining('libgcits-3.7.4-64.dylib'),
    );
  });
});
