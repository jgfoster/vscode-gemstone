import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import { ClaudeCliRegistrar, CommandRunner } from '../claudeCodeMcpRegistration';
import { appendSysadmin } from '../sysadminChannel';

function makeRunner(overrides: Partial<Record<string, unknown>> = {}): {
  runner: CommandRunner;
  calls: Array<{ command: string; args: string[]; cwd?: string }>;
} {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const runner: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    const op = args[1]; // 'add' or 'remove'
    if (overrides[op]) {
      const result = overrides[op];
      if (result instanceof Error) throw result;
      return result as { stdout: string; stderr: string };
    }
    return { stdout: '', stderr: '' };
  };
  return { runner, calls };
}

beforeEach(() => {
  vi.mocked(appendSysadmin).mockClear();
});

describe('ClaudeCliRegistrar.register', () => {
  it('removes any stale entry then adds the new one', async () => {
    const { runner, calls } = makeRunner();
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    const ok = await registrar.register('gemstone', 'node', ['/ext/proxy.js', '--proxy-socket', '/tmp/s.sock']);

    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      command: 'claude',
      args: ['mcp', 'remove', 'gemstone'],
      cwd: '/ws',
    });
    expect(calls[1]).toEqual({
      command: 'claude',
      args: ['mcp', 'add', 'gemstone', '--', 'node', '/ext/proxy.js', '--proxy-socket', '/tmp/s.sock'],
      cwd: '/ws',
    });
  });

  it('succeeds even when the pre-remove fails (no prior entry)', async () => {
    const err = new Error('No MCP server named gemstone');
    const { runner, calls } = makeRunner({ remove: err });
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    const ok = await registrar.register('gemstone', 'node', ['x']);

    expect(ok).toBe(true);
    expect(calls).toHaveLength(2); // remove attempted, then add
    expect(calls[1].args[1]).toBe('add');
  });

  it('returns false and logs a specific message when claude is not on PATH', async () => {
    // Both remove and add hit ENOENT when the binary is missing.
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const runner: CommandRunner = async () => { throw err; };
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    const ok = await registrar.register('gemstone', 'node', ['x']);

    expect(ok).toBe(false);
    const messages = vi.mocked(appendSysadmin).mock.calls.map(c => c[0]);
    expect(messages.some(m => /not on PATH/.test(m))).toBe(true);
  });

  it('returns false and logs the underlying error when add fails for other reasons', async () => {
    const err = new Error('invalid scope');
    const { runner } = makeRunner({ add: err });
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    const ok = await registrar.register('gemstone', 'node', ['x']);

    expect(ok).toBe(false);
    const messages = vi.mocked(appendSysadmin).mock.calls.map(c => c[0]);
    expect(messages.some(m => /invalid scope/.test(m))).toBe(true);
  });
});

describe('ClaudeCliRegistrar.unregister', () => {
  it('calls `claude mcp remove <name>`', async () => {
    const { runner, calls } = makeRunner();
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    const ok = await registrar.unregister('gemstone');

    expect(ok).toBe(true);
    expect(calls).toEqual([{
      command: 'claude',
      args: ['mcp', 'remove', 'gemstone'],
      cwd: '/ws',
    }]);
  });

  it('returns false silently when the entry does not exist', async () => {
    const err = new Error('No MCP server named gemstone');
    const { runner } = makeRunner({ remove: err });
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    const ok = await registrar.unregister('gemstone');

    expect(ok).toBe(false);
    // Don't surface "entry missing" noise; only log when the CLI itself is unavailable.
    const messages = vi.mocked(appendSysadmin).mock.calls.map(c => c[0]);
    expect(messages.some(m => /not on PATH/.test(m))).toBe(false);
  });

  it('logs a specific message when claude is not on PATH', async () => {
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const runner: CommandRunner = async () => { throw err; };
    const registrar = new ClaudeCliRegistrar('/ws', runner);

    await registrar.unregister('gemstone');

    const messages = vi.mocked(appendSysadmin).mock.calls.map(c => c[0]);
    expect(messages.some(m => /not on PATH/.test(m))).toBe(true);
  });
});
