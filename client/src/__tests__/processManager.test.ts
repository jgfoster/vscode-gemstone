import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('child_process');
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import { spawn } from 'child_process';
import { ProcessManager } from '../processManager';
import { GemStoneDatabase } from '../sysadminTypes';

// ── Helpers ────────────────────────────────────────────────

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

function makeStorage(gsPath = '/gs/3.7.4') {
  return {
    getRootPath: vi.fn(() => '/home/user/gemstone'),
    getGemstonePath: vi.fn(() => gsPath),
    getExtractedVersions: vi.fn(() => ['3.7.4']),
  };
}

/** Create a mock ChildProcess that emits 'close' with the given exit code. */
function makeChildProcess(exitCode = 0) {
  const stdoutListeners: Array<(data: Buffer) => void> = [];
  const stderrListeners: Array<(data: Buffer) => void> = [];
  let closeCallback: ((code: number) => void) | undefined;

  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stdoutListeners.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stderrListeners.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') closeCallback = cb;
    }),
    // Call this to simulate the process finishing
    finish() {
      closeCallback?.(exitCode);
    },
  };
  return proc;
}

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// ── Suite ──────────────────────────────────────────────────

describe('ProcessManager', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = process.platform;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.mocked(spawn).mockReset();
  });

  // ── runCommand spawn behaviour ────────────────────────────

  describe('runCommand (via startStone)', () => {
    it('on Linux wraps spawn in bash with ulimit -n 1024', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage as any);
      const db = makeDatabase();

      const promise = manager.startStone(db);
      proc.finish();
      await promise;

      expect(spawn).toHaveBeenCalledOnce();
      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toBe('/bin/bash');
      expect(args[0]).toBe('-c');
      expect(args[1]).toBe('ulimit -n 1024; exec "$@"');
      expect(args[2]).toBe('--');
      // The actual startstone binary should follow as the first exec argument
      expect(args[3]).toContain('startstone');
    });

    it('on Linux passes the stone arguments after the exec sentinel', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage as any);
      const db = makeDatabase();

      const promise = manager.startStone(db);
      proc.finish();
      await promise;

      const [, args] = vi.mocked(spawn).mock.calls[0];
      // args: ['-c', script, '--', cmd, '-l', logPath, stoneName]
      expect(args).toContain('-l');
      expect(args).toContain(db.config.stoneName);
    });

    it('on macOS spawns the binary directly without a shell wrapper', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage as any);
      const db = makeDatabase();

      const promise = manager.startStone(db);
      proc.finish();
      await promise;

      expect(spawn).toHaveBeenCalledOnce();
      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain('startstone');
      expect(args).not.toContain('ulimit');
    });

    it('on Linux the env is passed as the spawn options env', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage as any);
      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env).toBeDefined();
      expect((opts as any).env.GEMSTONE).toBe('/gs/3.7.4');
    });

    it('on Linux sets LD_LIBRARY_PATH (not DYLD_LIBRARY_PATH) in env', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage as any);
      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      const env = (opts as any).env;
      expect(env.LD_LIBRARY_PATH).toContain('/gs/3.7.4/lib');
      expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
    });

    it('on macOS sets DYLD_LIBRARY_PATH (not LD_LIBRARY_PATH) in env', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage as any);
      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      const env = (opts as any).env;
      expect(env.DYLD_LIBRARY_PATH).toContain('/gs/3.7.4/lib');
      expect(env.LD_LIBRARY_PATH).toBeUndefined();
    });

    it('rejects when the process exits with a non-zero code', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(1);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const manager = new ProcessManager(makeStorage() as any);
      const promise = manager.startStone(makeDatabase());
      proc.finish();

      await expect(promise).rejects.toThrow();
    });
  });

  // ── startNetldi spawn behaviour ───────────────────────────

  describe('runCommand (via startNetldi)', () => {
    it('on Linux also wraps startnetldi in the bash ulimit shell', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const manager = new ProcessManager(makeStorage() as any);
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();
      await promise;

      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toBe('/bin/bash');
      expect(args[3]).toContain('startnetldi');
    });

    it('on macOS spawns startnetldi directly', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(0);
      vi.mocked(spawn).mockReturnValue(proc as any);

      const manager = new ProcessManager(makeStorage() as any);
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();
      await promise;

      const [cmd] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain('startnetldi');
    });
  });
});
