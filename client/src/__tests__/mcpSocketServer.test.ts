import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('fs');
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  claudeDesktopConfigPath,
  mcpServerNameFor,
  proxyScriptPath,
  removeClaudeDesktopMcpConfig,
  socketPathFor,
  writeClaudeDesktopMcpConfig,
} from '../mcpSocketServer';

function withPlatform(platform: string, fn: () => void) {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  }
}

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
    withPlatform('win32', () => {
      expect(socketPathFor('x')).toMatch(/^\\\\\.\\pipe\\jasper-mcp-/);
    });
  });

  it('uses a filesystem path on non-Windows', () => {
    withPlatform('darwin', () => {
      expect(socketPathFor('x')).toMatch(/jasper-mcp-[a-f0-9]+\.sock$/);
    });
  });
});

describe('proxyScriptPath', () => {
  it('resolves to mcp-server/out/index.js inside the extension', () => {
    expect(proxyScriptPath('/ext')).toMatch(/mcp-server[\\/]+out[\\/]+index\.js$/);
  });
});

describe('mcpServerNameFor', () => {
  it('is stable for the same workspace key', () => {
    expect(mcpServerNameFor('/a')).toBe(mcpServerNameFor('/a'));
  });

  it('differs between workspaces', () => {
    expect(mcpServerNameFor('/a')).not.toBe(mcpServerNameFor('/b'));
  });

  it('uses the gemstone-<hash> format', () => {
    expect(mcpServerNameFor('/ws')).toMatch(/^gemstone-[a-f0-9]{10}$/);
  });

  it('shares the same hash as the socket path for the workspace', () => {
    withPlatform('darwin', () => {
      const name = mcpServerNameFor('/ws');
      const sock = socketPathFor('/ws');
      const hash = name.replace(/^gemstone-/, '');
      expect(sock).toContain(hash);
    });
  });
});

describe('claudeDesktopConfigPath', () => {
  it('resolves the macOS Application Support path', () => {
    withPlatform('darwin', () => {
      expect(claudeDesktopConfigPath()).toBe(
        path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      );
    });
  });

  it('resolves the Windows %APPDATA% path', () => {
    const origAppData = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
    try {
      withPlatform('win32', () => {
        expect(claudeDesktopConfigPath()).toBe(
          path.join('C:\\Users\\me\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
        );
      });
    } finally {
      if (origAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = origAppData;
    }
  });

  it('falls back to ~/.config on Linux', () => {
    withPlatform('linux', () => {
      expect(claudeDesktopConfigPath()).toBe(
        path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
      );
    });
  });
});

describe('writeClaudeDesktopMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.mkdirSync).mockClear();
  });

  it('writes a per-workspace gemstone-<hash> entry pointing at the proxy socket', () => {
    writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    const name = mcpServerNameFor('/ws');
    expect(written.mcpServers[name].command).toBe('node');
    expect(written.mcpServers[name].args).toContain('--proxy-socket');
    expect(written.mcpServers[name].args).toContain('/tmp/socket.sock');
    expect(written.mcpServers[name].env).toBeUndefined();
  });

  it('returns the platform-specific Desktop config path', () => {
    withPlatform('darwin', () => {
      const returned = writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock');
      expect(returned).toBe(claudeDesktopConfigPath());
    });
  });

  it('preserves other mcpServers entries (including other workspaces)', () => {
    const otherName = mcpServerNameFor('/other-ws');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        [otherName]: { command: 'node', args: ['elsewhere'] },
        filesystem: { command: 'mcp-fs' },
      },
    }));

    writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers[otherName]).toEqual({ command: 'node', args: ['elsewhere'] });
    expect(written.mcpServers.filesystem).toEqual({ command: 'mcp-fs' });
    expect(written.mcpServers[mcpServerNameFor('/ws')]).toBeDefined();
  });

  it('preserves top-level siblings of mcpServers', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      globalShortcut: 'Ctrl+Space',
      mcpServers: {},
    }));

    writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.globalShortcut).toBe('Ctrl+Space');
  });

  it('does not rewrite when the entry is already correct', () => {
    const name = mcpServerNameFor('/ws');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        [name]: {
          command: 'node',
          args: [proxyScriptPath('/ext'), '--proxy-socket', '/tmp/socket.sock'],
        },
      },
    }));

    writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rewrites when the socket path has changed', () => {
    const name = mcpServerNameFor('/ws');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        [name]: {
          command: 'node',
          args: [proxyScriptPath('/ext'), '--proxy-socket', '/tmp/OLD.sock'],
        },
      },
    }));

    writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/NEW.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers[name].args).toContain('/tmp/NEW.sock');
  });

  it('creates the Claude config directory if missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      // File doesn't exist, and neither does its parent dir — force mkdir.
      const s = String(p);
      return !s.endsWith('claude_desktop_config.json') && !s.endsWith('Claude');
    });

    writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringMatching(/Claude$/),
      { recursive: true },
    );
  });

  it('recovers from an unreadable config by starting fresh (without throwing)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not-valid-json');

    expect(() => writeClaudeDesktopMcpConfig('/ws', '/ext', '/tmp/socket.sock')).not.toThrow();

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers[mcpServerNameFor('/ws')]).toBeDefined();
  });
});

describe('removeClaudeDesktopMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockClear();
  });

  it('removes only this workspace entry and preserves siblings', () => {
    const name = mcpServerNameFor('/ws');
    const otherName = mcpServerNameFor('/other-ws');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        [name]: { command: 'node', args: ['x'] },
        [otherName]: { command: 'node', args: ['y'] },
        filesystem: { command: 'mcp-fs' },
      },
    }));

    removeClaudeDesktopMcpConfig('/ws');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers[name]).toBeUndefined();
    expect(written.mcpServers[otherName]).toEqual({ command: 'node', args: ['y'] });
    expect(written.mcpServers.filesystem).toEqual({ command: 'mcp-fs' });
  });

  it('is a no-op when the config file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    removeClaudeDesktopMcpConfig('/ws');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('is a no-op when mcpServers is absent', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

    removeClaudeDesktopMcpConfig('/ws');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('is a no-op when this workspace has no entry', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { [mcpServerNameFor('/different')]: { command: 'node' } },
    }));

    removeClaudeDesktopMcpConfig('/ws');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
