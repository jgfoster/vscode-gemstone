import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('child_process');
vi.mock('fs');
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import { spawn } from 'child_process';
import * as fs from 'fs';
import { McpServerManager } from '../mcpServerManager';
import { GemStoneLogin } from '../loginTypes';
import { GemStoneDatabase } from '../sysadminTypes';
import { workspace } from '../__mocks__/vscode';

function makeDatabase(overrides: Partial<GemStoneDatabase> = {}): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/home/user/gemstone/db-1',
    config: {
      version: '3.7.4',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
    },
    ...overrides,
  };
}

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return {
    label: 'Test',
    version: '3.7.4',
    gem_host: 'localhost',
    stone: 'gs64stone',
    gs_user: 'DataCurator',
    gs_password: 'swordfish',
    netldi: 'gs64ldi',
    host_user: '',
    host_password: '',
    ...overrides,
  };
}

function makeSysadminStorage(gsPath: string | null = '/gs/3.7.4') {
  return {
    getRootPath: vi.fn(() => '/home/user/gemstone'),
    getGemstonePath: vi.fn(() => gsPath),
  };
}

function makeLoginStorage(gciPath: string | null = '/gs/3.7.4/lib/libgcits.dylib') {
  return {
    getGciLibraryPath: vi.fn(() => gciPath),
  };
}

function makeChildProcess() {
  const stdoutListeners: Array<(data: Buffer) => void> = [];
  const stderrListeners: Array<(data: Buffer) => void> = [];
  const eventListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stdoutListeners.push(cb);
      }),
      removeListener: vi.fn(),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stderrListeners.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(cb);
    }),
    kill: vi.fn(),
    emitStdout(data: string) {
      for (const cb of stdoutListeners) cb(Buffer.from(data));
    },
    emitExit(code: number) {
      for (const cb of (eventListeners['exit'] || [])) cb(code);
    },
  };
  return proc;
}

describe('McpServerManager', () => {
  let manager: McpServerManager;

  beforeEach(() => {
    manager = new McpServerManager('/ext/path');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    (workspace as { workspaceFolders?: unknown[] }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  afterEach(() => {
    manager.dispose();
    vi.mocked(spawn).mockReset();
  });

  describe('startServer', () => {
    it('spawns the MCP server process and captures the port', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const db = makeDatabase();
      const login = makeLogin();

      const promise = manager.startServer(
        db, login,
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );

      // Simulate port output
      proc.emitStdout('{"port":12345}\n');

      const info = await promise;
      expect(info.port).toBe(12345);
      expect(info.stoneName).toBe('gs64stone');
      expect(info.login.gs_user).toBe('DataCurator');
      expect(manager.isRunning('gs64stone')).toBe(true);
    });

    it('skips GCI diagnostic output before the port line', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const promise = manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );

      // GCI prints diagnostic lines before the port JSON
      proc.emitStdout('gcits login: session 0xc19470000 lgc 0xc19470008 rpc gem processId 58437\n');
      proc.emitStdout('{"port":9876}\n');

      const info = await promise;
      expect(info.port).toBe(9876);
    });

    it('passes credentials via environment variables', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const db = makeDatabase();
      const login = makeLogin({ gs_password: 'secret123' });

      const promise = manager.startServer(
        db, login,
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":9999}\n');
      await promise;

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const spawnEnv = (spawnCall[2] as { env: Record<string, string> }).env;
      expect(spawnEnv.GS_PASSWORD).toBe('secret123');
    });

    it('throws if already running for same stone', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const db = makeDatabase();
      const login = makeLogin();

      const promise = manager.startServer(
        db, login,
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":1111}\n');
      await promise;

      await expect(manager.startServer(
        db, login,
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      )).rejects.toThrow('already running');
    });

    it('throws if no GCI library found', async () => {
      await expect(manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage(null) as never,
        makeLoginStorage(null) as never,
      )).rejects.toThrow('No GCI library');
    });

    it('passes --transport sse to the child process', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const promise = manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":5555}\n');
      await promise;

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).toContain('--transport');
      expect(args[args.indexOf('--transport') + 1]).toBe('sse');
    });
  });

  describe('stopServer', () => {
    it('sends SIGTERM and removes from map', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const promise = manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":7777}\n');
      await promise;
      expect(manager.isRunning('gs64stone')).toBe(true);

      const stopPromise = manager.stopServer('gs64stone');
      proc.emitExit(0);
      await stopPromise;

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(manager.isRunning('gs64stone')).toBe(false);
    });

    it('does nothing if not running', async () => {
      await manager.stopServer('nonexistent');
      // Should not throw
    });
  });

  describe('getServerInfo', () => {
    it('returns info for running server', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const promise = manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":8888}\n');
      await promise;

      const info = manager.getServerInfo('gs64stone');
      expect(info).toBeDefined();
      expect(info!.port).toBe(8888);
    });

    it('returns undefined for non-running server', () => {
      expect(manager.getServerInfo('gs64stone')).toBeUndefined();
    });
  });

  describe('onDidChange', () => {
    it('fires when the MCP server process exits unexpectedly', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const promise = manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":4444}\n');
      await promise;

      const listener = vi.fn();
      manager.onDidChange(listener);

      proc.emitExit(1);

      expect(listener).toHaveBeenCalled();
      expect(manager.isRunning('gs64stone')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('kills all running servers and cleans up settings', async () => {
      const proc = makeChildProcess();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const promise = manager.startServer(
        makeDatabase(),
        makeLogin(),
        makeSysadminStorage() as never,
        makeLoginStorage() as never,
      );
      proc.emitStdout('{"port":3333}\n');
      await promise;

      manager.dispose();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(manager.isRunning('gs64stone')).toBe(false);
    });
  });
});
