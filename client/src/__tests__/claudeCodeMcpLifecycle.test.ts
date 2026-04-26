import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { ClaudeCodeMcpLifecycle, SocketServerHandle } from '../claudeCodeMcpLifecycle';
import { McpRegistrar } from '../claudeCodeMcpRegistration';

function makeHarness() {
  const disposeSocket = vi.fn().mockResolvedValue(undefined);
  let socketCount = 0;
  const startSocket = vi.fn(async (): Promise<SocketServerHandle> => {
    socketCount++;
    return { socketPath: `/tmp/socket-${socketCount}.sock`, dispose: disposeSocket };
  });

  const registrar: McpRegistrar & {
    register: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
  } = {
    register: vi.fn().mockResolvedValue(true),
    unregister: vi.fn().mockResolvedValue(true),
  };

  const lifecycle = new ClaudeCodeMcpLifecycle({
    serverName: 'gemstone',
    proxyCommand: 'node',
    proxyArgs: ['/ext/proxy.js'],
    startSocket,
    registrar,
  });

  return { lifecycle, startSocket, disposeSocket, registrar };
}

describe('ClaudeCodeMcpLifecycle', () => {
  it('starts the socket and registers on start()', async () => {
    const { lifecycle, startSocket, registrar } = makeHarness();

    await lifecycle.start();

    expect(startSocket).toHaveBeenCalledTimes(1);
    expect(registrar.register).toHaveBeenCalledWith(
      'gemstone',
      'node',
      ['/ext/proxy.js', '--proxy-socket', '/tmp/socket-1.sock'],
    );
    expect(lifecycle.isActive).toBe(true);
  });

  it('is idempotent when start() is called twice', async () => {
    const { lifecycle, startSocket, registrar } = makeHarness();

    await lifecycle.start();
    await lifecycle.start();

    expect(startSocket).toHaveBeenCalledTimes(1);
    expect(registrar.register).toHaveBeenCalledTimes(1);
  });

  it('unregisters and disposes the socket on dispose()', async () => {
    const { lifecycle, disposeSocket, registrar } = makeHarness();

    await lifecycle.start();
    await lifecycle.dispose();

    expect(registrar.unregister).toHaveBeenCalledWith('gemstone');
    expect(disposeSocket).toHaveBeenCalledTimes(1);
    expect(lifecycle.isActive).toBe(false);
  });

  it('is a no-op on dispose() before start()', async () => {
    const { lifecycle, registrar, disposeSocket } = makeHarness();

    await lifecycle.dispose();

    expect(registrar.unregister).not.toHaveBeenCalled();
    expect(disposeSocket).not.toHaveBeenCalled();
  });

  it('skips unregister if the initial register failed', async () => {
    const { lifecycle, registrar, disposeSocket } = makeHarness();
    registrar.register.mockResolvedValueOnce(false);

    await lifecycle.start();
    await lifecycle.dispose();

    expect(registrar.unregister).not.toHaveBeenCalled();
    // Socket still cleaned up — the extension owns its lifecycle regardless.
    expect(disposeSocket).toHaveBeenCalledTimes(1);
  });

  it('supports restart after dispose', async () => {
    const { lifecycle, startSocket, registrar } = makeHarness();

    await lifecycle.start();
    await lifecycle.dispose();
    await lifecycle.start();

    expect(startSocket).toHaveBeenCalledTimes(2);
    expect(registrar.register).toHaveBeenCalledTimes(2);
    expect(registrar.unregister).toHaveBeenCalledTimes(1);
    expect(lifecycle.isActive).toBe(true);
  });
});
