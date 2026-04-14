import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { DatabaseTreeProvider, DatabaseNode } from '../databaseTreeProvider';
import { GemStoneDatabase } from '../sysadminTypes';

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

function makeStorage(databases: GemStoneDatabase[] = [makeDatabase()]) {
  return {
    getDatabases: vi.fn(() => databases),
  };
}

function makeProcessManager(stoneRunning = false, netldiRunning = false) {
  return {
    isStoneRunning: vi.fn(() => stoneRunning),
    isNetldiRunning: vi.fn(() => netldiRunning),
    getProcesses: vi.fn(() => []),
  };
}

function makeMcpServerManager(
  running = false,
  port?: number,
  gsUser?: string,
) {
  return {
    isRunning: vi.fn(() => running),
    getServerInfo: vi.fn(() =>
      running ? { port, login: { gs_user: gsUser }, stoneName: 'gs64stone' } : undefined,
    ),
  };
}

describe('DatabaseTreeProvider', () => {
  describe('getChildren', () => {
    it('returns database nodes at the root', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
      );

      const children = provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].kind).toBe('database');
    });

    it('includes mcpServer node under a database', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
        makeMcpServerManager() as never,
      );

      const dbNode: DatabaseNode = { kind: 'database', db };
      const children = provider.getChildren(dbNode);
      const kinds = children.map(c => c.kind);

      expect(kinds).toContain('stone');
      expect(kinds).toContain('netldi');
      expect(kinds).toContain('mcpServer');
      expect(kinds).toContain('logs');
      expect(kinds).toContain('config');
    });

    it('shows mcpServer as running with port and user', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
        makeMcpServerManager(true, 38741, 'DataCurator') as never,
      );

      const dbNode: DatabaseNode = { kind: 'database', db };
      const children = provider.getChildren(dbNode);
      const mcpNode = children.find(c => c.kind === 'mcpServer');

      expect(mcpNode).toBeDefined();
      expect(mcpNode!.kind).toBe('mcpServer');
      if (mcpNode!.kind === 'mcpServer') {
        expect(mcpNode!.running).toBe(true);
        expect(mcpNode!.port).toBe(38741);
        expect(mcpNode!.gsUser).toBe('DataCurator');
      }
    });

    it('shows mcpServer as stopped when no manager', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
      );

      const dbNode: DatabaseNode = { kind: 'database', db };
      const children = provider.getChildren(dbNode);
      const mcpNode = children.find(c => c.kind === 'mcpServer');

      expect(mcpNode).toBeDefined();
      if (mcpNode!.kind === 'mcpServer') {
        expect(mcpNode!.running).toBe(false);
      }
    });
  });

  describe('getTreeItem', () => {
    let provider: DatabaseTreeProvider;
    const db = makeDatabase();

    beforeEach(() => {
      provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
        makeMcpServerManager(true, 38741, 'DataCurator') as never,
      );
    });

    it('renders running MCP server with user and port', () => {
      const node: DatabaseNode = {
        kind: 'mcpServer', db, running: true, port: 38741, gsUser: 'DataCurator',
      };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('MCP Server: DataCurator @ 38741');
      expect(item.description).toBe('Running');
      expect(item.contextValue).toBe('gemstoneDbMcpRunning');
    });

    it('renders stopped MCP server', () => {
      const node: DatabaseNode = {
        kind: 'mcpServer', db, running: false,
      };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('MCP Server');
      expect(item.description).toBe('Stopped');
      expect(item.contextValue).toBe('gemstoneDbMcpStopped');
    });

    it('renders database node', () => {
      const node: DatabaseNode = { kind: 'database', db };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('db-1');
      expect(item.contextValue).toBe('gemstoneDb');
    });

    it('renders stone node', () => {
      const node: DatabaseNode = { kind: 'stone', db, running: true };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('Stone: gs64stone');
      expect(item.contextValue).toBe('gemstoneDbStoneRunning');
    });

    it('renders netldi node', () => {
      const node: DatabaseNode = { kind: 'netldi', db, running: false };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('NetLDI: gs64ldi');
      expect(item.contextValue).toBe('gemstoneDbNetldiStopped');
    });
  });
});
