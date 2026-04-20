import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { window } from '../__mocks__/vscode';
import { DatabaseNode } from '../databaseTreeProvider';
import { GemStoneDatabase } from '../sysadminTypes';

function makeDatabase(): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/home/user/gemstone/db-1',
    config: {
      version: '3.7.4',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
    },
  };
}

// Mirrors the logic in extension.ts
interface MockTerminal { show(): void; sendText(text: string): void; dispose(): void }
const inspectorTerminals = new Map<string, MockTerminal>();

function openMcpInspector(node: DatabaseNode): void {
  if (node.kind !== 'mcpServer' || !node.running || !node.port) return;
  const existing = inspectorTerminals.get(node.db.config.stoneName);
  if (existing) {
    existing.dispose();
  }
  const serverUrl = `http://localhost:${node.port}/sse`;
  const terminal = window.createTerminal({
    name: `MCP Inspector: ${node.db.config.stoneName}`,
  });
  inspectorTerminals.set(node.db.config.stoneName, terminal);
  terminal.show();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  terminal.sendText(
    `${npx} @modelcontextprotocol/inspector --transport sse --server-url ${serverUrl}`,
  );
}

function stopMcpServer(stoneName: string): void {
  const inspectorTerminal = inspectorTerminals.get(stoneName);
  if (inspectorTerminal) {
    inspectorTerminal.dispose();
    inspectorTerminals.delete(stoneName);
  }
}

describe('openMcpInspector', () => {
  beforeEach(() => {
    vi.mocked(window.createTerminal).mockClear();
    inspectorTerminals.clear();
  });

  it('opens a terminal with the inspector command for a running server', () => {
    const node: DatabaseNode = {
      kind: 'mcpServer',
      db: makeDatabase(),
      running: true,
      port: 38741,
      gsUser: 'DataCurator',
    };

    openMcpInspector(node);

    expect(window.createTerminal).toHaveBeenCalledWith({
      name: 'MCP Inspector: gs64stone',
    });
    const terminal = vi.mocked(window.createTerminal).mock.results[0].value;
    expect(terminal.show).toHaveBeenCalled();
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    expect(terminal.sendText).toHaveBeenCalledWith(
      `${npx} @modelcontextprotocol/inspector --transport sse --server-url http://localhost:38741/sse`,
    );
  });

  it('does nothing if the server is not running', () => {
    const node: DatabaseNode = {
      kind: 'mcpServer',
      db: makeDatabase(),
      running: false,
    };

    openMcpInspector(node);

    expect(window.createTerminal).not.toHaveBeenCalled();
  });

  it('does nothing for non-mcpServer nodes', () => {
    const node: DatabaseNode = {
      kind: 'stone',
      db: makeDatabase(),
      running: true,
    };

    openMcpInspector(node);

    expect(window.createTerminal).not.toHaveBeenCalled();
  });

  it('disposes the previous terminal when opening a second inspector', () => {
    const node: DatabaseNode = {
      kind: 'mcpServer',
      db: makeDatabase(),
      running: true,
      port: 38741,
      gsUser: 'DataCurator',
    };

    openMcpInspector(node);
    const firstTerminal = vi.mocked(window.createTerminal).mock.results[0].value;

    // Open again — should dispose the first terminal
    openMcpInspector({ ...node, port: 44444 });

    expect(firstTerminal.dispose).toHaveBeenCalled();
    expect(window.createTerminal).toHaveBeenCalledTimes(2);
  });

  it('tracks the terminal by stone name', () => {
    const node: DatabaseNode = {
      kind: 'mcpServer',
      db: makeDatabase(),
      running: true,
      port: 38741,
      gsUser: 'DataCurator',
    };

    openMcpInspector(node);

    expect(inspectorTerminals.has('gs64stone')).toBe(true);
  });

  // Regression: PowerShell's default ExecutionPolicy blocks `npx` (.ps1).
  // Invoking `npx.cmd` goes through CreateProcess and succeeds regardless.
  describe('platform-specific npx invocation', () => {
    const originalPlatform = process.platform;
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    function runFor(platform: NodeJS.Platform): string {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      const node: DatabaseNode = {
        kind: 'mcpServer', db: makeDatabase(), running: true, port: 38741, gsUser: 'DataCurator',
      };
      openMcpInspector(node);
      const terminal = vi.mocked(window.createTerminal).mock.results[0].value;
      return vi.mocked(terminal.sendText).mock.calls[0][0] as string;
    }

    it('uses npx.cmd on Windows to bypass PowerShell ExecutionPolicy', () => {
      const sent = runFor('win32');
      expect(sent.startsWith('npx.cmd ')).toBe(true);
    });

    it('uses plain npx on macOS', () => {
      const sent = runFor('darwin');
      expect(sent.startsWith('npx ')).toBe(true);
      expect(sent.startsWith('npx.cmd')).toBe(false);
    });

    it('uses plain npx on Linux', () => {
      const sent = runFor('linux');
      expect(sent.startsWith('npx ')).toBe(true);
      expect(sent.startsWith('npx.cmd')).toBe(false);
    });
  });
});

describe('stopMcpServer disposes inspector terminal', () => {
  beforeEach(() => {
    vi.mocked(window.createTerminal).mockClear();
    inspectorTerminals.clear();
  });

  it('disposes the inspector terminal when stopping the MCP server', () => {
    const node: DatabaseNode = {
      kind: 'mcpServer',
      db: makeDatabase(),
      running: true,
      port: 38741,
      gsUser: 'DataCurator',
    };

    openMcpInspector(node);
    const terminal = vi.mocked(window.createTerminal).mock.results[0].value;

    stopMcpServer('gs64stone');

    expect(terminal.dispose).toHaveBeenCalled();
    expect(inspectorTerminals.has('gs64stone')).toBe(false);
  });

  it('does nothing if no inspector is open', () => {
    stopMcpServer('gs64stone');
    // Should not throw
    expect(inspectorTerminals.size).toBe(0);
  });
});
