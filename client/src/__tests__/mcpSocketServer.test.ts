import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('fs');
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import * as fs from 'fs';
import { socketPathFor, writeClaudeCodeMcpConfig } from '../mcpSocketServer';

describe('socketPathFor', () => {
  it('returns a stable path for the same workspace key', () => {
    const a = socketPathFor('/Users/me/project');
    const b = socketPathFor('/Users/me/project');
    expect(a).toBe(b);
  });

  it('returns different paths for different workspaces', () => {
    const a = socketPathFor('/Users/me/project-a');
    const b = socketPathFor('/Users/me/project-b');
    expect(a).not.toBe(b);
  });

  it('uses a named pipe format on Windows', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expect(socketPathFor('x')).toMatch(/^\\\\\.\\pipe\\jasper-mcp-/);
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });

  it('uses a filesystem path on non-Windows', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      expect(socketPathFor('x')).toMatch(/jasper-mcp-[a-f0-9]+\.sock$/);
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });
});

describe('writeClaudeCodeMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.mkdirSync).mockClear();
  });

  it('writes a stdio command with --proxy-socket pointing at the given socket', () => {
    writeClaudeCodeMcpConfig('/workspace', '/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.gemstone.command).toBe('node');
    expect(written.mcpServers.gemstone.args).toContain('--proxy-socket');
    expect(written.mcpServers.gemstone.args).toContain('/tmp/socket.sock');
    // Must NOT include env or password fields — proxy mode needs no credentials.
    expect(written.mcpServers.gemstone.env).toBeUndefined();
  });

  it('preserves other mcpServers entries', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { other: { command: 'x' } },
    }));

    writeClaudeCodeMcpConfig('/workspace', '/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.other).toEqual({ command: 'x' });
    expect(written.mcpServers.gemstone).toBeDefined();
  });

  it('does not rewrite the file when the entry is already correct', () => {
    const proxyScript = '/ext/mcp-server/out/index.js';
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        gemstone: {
          command: 'node',
          args: [proxyScript, '--proxy-socket', '/tmp/socket.sock'],
        },
      },
    }));

    writeClaudeCodeMcpConfig('/workspace', '/ext', '/tmp/socket.sock');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rewrites when the socket path has changed', () => {
    const proxyScript = '/ext/mcp-server/out/index.js';
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        gemstone: {
          command: 'node',
          args: [proxyScript, '--proxy-socket', '/tmp/OLD.sock'],
        },
      },
    }));

    writeClaudeCodeMcpConfig('/workspace', '/ext', '/tmp/NEW.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers.gemstone.args).toContain('/tmp/NEW.sock');
  });

  it('creates the .claude directory if missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).endsWith('.claude'));
    writeClaudeCodeMcpConfig('/workspace', '/ext', '/tmp/socket.sock');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.claude$/),
      { recursive: true },
    );
  });
});
