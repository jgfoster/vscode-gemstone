import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => {
  const configValues: Record<string, unknown> = {};
  return {
    workspace: {
      getConfiguration: vi.fn((_section: string) => ({
        get: vi.fn((key: string, defaultValue?: unknown) => {
          return configValues[key] ?? defaultValue;
        }),
      })),
      workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
    },
    window: {
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      withProgress: vi.fn(async (_opts: unknown, task: (progress: unknown, token: unknown) => Promise<void>) => {
        const progress = { report: vi.fn() };
        const token = { isCancellationRequested: false };
        return task(progress, token);
      }),
    },
    ProgressLocation: { Notification: 15 },
    __setConfigValue: (key: string, value: unknown) => { configValues[key] = value; },
    __resetConfig: () => { for (const k of Object.keys(configValues)) delete configValues[k]; },
  };
});

vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
  getClassNames: vi.fn((session: unknown, dictIndex: number) => {
    if (dictIndex === 1) return ['MyClass', 'OtherClass'];
    if (dictIndex === 2) return ['Array', 'String'];
    return [];
  }),
  fileOutClass: vi.fn((_session: unknown, _dictIndex: number, className: string) => {
    return `! fileout of ${className}\n`;
  }),
}));

import { ExportManager } from '../exportManager';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';
import * as vscode from 'vscode';

function createMockSession(overrides?: Partial<GemStoneLogin>): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
      exportPath: '',
      ...overrides,
    },
    stoneVersion: '3.7.2',
  };
}

describe('ExportManager', () => {
  let manager: ExportManager;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations (tests may override these)
    (queries.getDictionaryNames as ReturnType<typeof vi.fn>).mockReturnValue(['UserGlobals', 'Globals']);
    (queries.getClassNames as ReturnType<typeof vi.fn>).mockImplementation((_s: unknown, dictIndex: number) => {
      if (dictIndex === 1) return ['MyClass', 'OtherClass'];
      if (dictIndex === 2) return ['Array', 'String'];
      return [];
    });
    (queries.fileOutClass as ReturnType<typeof vi.fn>).mockImplementation((_s: unknown, _d: number, className: string) => {
      return `! fileout of ${className}\n`;
    });
    manager = new ExportManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemstone-export-test-'));
    // Point workspace to temp dir
    const wsModule = vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] };
    wsModule.workspaceFolders = [{ uri: { fsPath: tmpDir } }];
  });

  afterEach(() => {
    manager.dispose();
    (vscode as unknown as { __resetConfig: () => void }).__resetConfig();
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getExportRoot', () => {
    it('returns {workspace}/gemstone by default', () => {
      const root = manager.getExportRoot();
      expect(root).toBe(path.join(tmpDir, 'gemstone'));
    });

    it('returns undefined when no workspace is open', () => {
      const wsModule = vscode.workspace as unknown as { workspaceFolders: null };
      wsModule.workspaceFolders = null;
      expect(manager.getExportRoot()).toBeUndefined();
    });

    it('resolves a relative exportPath against the workspace root', () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('exportPath', 'smalltalk');
      expect(manager.getExportRoot()).toBe(path.join(tmpDir, 'smalltalk'));
    });

    it('returns an absolute exportPath as-is', () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('exportPath', '/custom/absolute/path');
      expect(manager.getExportRoot()).toBe('/custom/absolute/path');
    });

    it('expands {workspaceRoot} in exportPath', () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('exportPath', '{workspaceRoot}/my-exports');
      expect(manager.getExportRoot()).toBe(path.join(tmpDir, 'my-exports'));
    });

    it('returns undefined for relative exportPath when no workspace is open', () => {
      const mockVscode = vscode as unknown as {
        __setConfigValue: (key: string, value: unknown) => void;
      };
      mockVscode.__setConfigValue('exportPath', 'smalltalk');
      const wsModule = vscode.workspace as unknown as { workspaceFolders: null };
      wsModule.workspaceFolders = null;
      expect(manager.getExportRoot()).toBeUndefined();
    });
  });

  describe('getSessionRoot', () => {
    it('returns {exportRoot}/{host}/{stone}/{user}', () => {
      const session = createMockSession();
      const root = manager.getSessionRoot(session);
      expect(root).toBe(path.join(tmpDir, 'gemstone', 'localhost', 'gs64stone', 'DataCurator'));
    });
  });

  describe('exportSession', () => {
    it('creates numbered dictionary directories with class files', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;

      // Check directory structure
      const dict1Dir = path.join(sessionRoot, '1-UserGlobals');
      const dict2Dir = path.join(sessionRoot, '2-Globals');
      expect(fs.existsSync(dict1Dir)).toBe(true);
      expect(fs.existsSync(dict2Dir)).toBe(true);

      // Check files exist with correct content
      expect(fs.readFileSync(path.join(dict1Dir, 'MyClass.gs'), 'utf-8')).toBe('! fileout of MyClass\n');
      expect(fs.readFileSync(path.join(dict1Dir, 'OtherClass.gs'), 'utf-8')).toBe('! fileout of OtherClass\n');
      expect(fs.readFileSync(path.join(dict2Dir, 'Array.gs'), 'utf-8')).toBe('! fileout of Array\n');
      expect(fs.readFileSync(path.join(dict2Dir, 'String.gs'), 'utf-8')).toBe('! fileout of String\n');
    });

    it('calls fileOutClass with correct dictionary index and class name', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      const mockFileOut = queries.fileOutClass as ReturnType<typeof vi.fn>;
      expect(mockFileOut).toHaveBeenCalledWith(session, 1, 'MyClass');
      expect(mockFileOut).toHaveBeenCalledWith(session, 1, 'OtherClass');
      expect(mockFileOut).toHaveBeenCalledWith(session, 2, 'Array');
      expect(mockFileOut).toHaveBeenCalledWith(session, 2, 'String');
    });

    it('shows progress notification', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Exporting GemStone classes' }),
        expect.any(Function),
      );
    });

    it('shows completion message with count', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Exported 4 classes from 2 dictionaries.',
      );
    });

    it('warns when no workspace is open', async () => {
      const wsModule = vscode.workspace as unknown as { workspaceFolders: null };
      wsModule.workspaceFolders = null;

      const session = createMockSession();
      await manager.exportSession(session);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No workspace folder'),
      );
    });

    it('continues when a single class export fails', async () => {
      const mockFileOut = queries.fileOutClass as ReturnType<typeof vi.fn>;
      mockFileOut.mockImplementation((_s: unknown, _d: number, className: string) => {
        if (className === 'OtherClass') throw new Error('Kernel class');
        return `! fileout of ${className}\n`;
      });

      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      // MyClass should still exist
      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals', 'MyClass.gs'))).toBe(true);
      // OtherClass should not
      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals', 'OtherClass.gs'))).toBe(false);
    });

    it('creates directories for empty dictionaries', async () => {
      // "Published" has no classes but should still get a directory
      const mockGetClassNames = queries.getClassNames as ReturnType<typeof vi.fn>;
      mockGetClassNames.mockImplementation(() => []);

      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals'))).toBe(true);
      expect(fs.existsSync(path.join(sessionRoot, '2-Globals'))).toBe(true);
    });

    it('removes stale dictionary directories on re-export', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      expect(fs.existsSync(path.join(sessionRoot, '2-Globals'))).toBe(true);

      // Simulate dictionary removal — second export has fewer dictionaries
      (queries.getDictionaryNames as ReturnType<typeof vi.fn>).mockReturnValue(['UserGlobals']);
      (queries.getClassNames as ReturnType<typeof vi.fn>).mockImplementation((_s: unknown, dictIndex: number) => {
        if (dictIndex === 1) return ['MyClass', 'OtherClass'];
        return [];
      });

      await manager.refreshSession(session);

      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals'))).toBe(true);
      expect(fs.existsSync(path.join(sessionRoot, '2-Globals'))).toBe(false);
    });

    it('removes stale files on re-export', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      const staleFile = path.join(sessionRoot, '1-UserGlobals', 'MyClass.gs');
      expect(fs.existsSync(staleFile)).toBe(true);

      // Simulate class removal — second export returns fewer classes
      const mockGetClassNames = queries.getClassNames as ReturnType<typeof vi.fn>;
      mockGetClassNames.mockImplementation((_s: unknown, dictIndex: number) => {
        if (dictIndex === 1) return ['OtherClass']; // MyClass removed
        if (dictIndex === 2) return ['Array', 'String'];
        return [];
      });

      await manager.refreshSession(session);

      expect(fs.existsSync(staleFile)).toBe(false);
      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals', 'OtherClass.gs'))).toBe(true);
    });
  });

  describe('markReadOnly / markWritable', () => {
    it('marks all .gs files as read-only', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      manager.markReadOnly(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      const filePath = path.join(sessionRoot, '1-UserGlobals', 'MyClass.gs');
      const stat = fs.statSync(filePath);
      // Check that write bits are cleared (owner, group, other)
      expect(stat.mode & 0o222).toBe(0);
    });

    it('marks all .gs files as writable', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      manager.markReadOnly(session);
      manager.markWritable(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      const filePath = path.join(sessionRoot, '1-UserGlobals', 'MyClass.gs');
      const stat = fs.statSync(filePath);
      // Check that owner write bit is set
      expect(stat.mode & 0o200).not.toBe(0);
    });
  });

  describe('isWriting', () => {
    it('is false when not exporting', () => {
      expect(manager.isWriting).toBe(false);
    });
  });

  describe('multiple sessions', () => {
    it('exports to separate directories for different sessions', async () => {
      const session1 = createMockSession({ gem_host: 'host1', stone: 'stone1', gs_user: 'user1' });
      session1.id = 1;
      const session2 = createMockSession({ gem_host: 'host2', stone: 'stone2', gs_user: 'user2' });
      session2.id = 2;

      await manager.exportSession(session1);
      await manager.exportSession(session2);

      const root1 = manager.getSessionRoot(session1)!;
      const root2 = manager.getSessionRoot(session2)!;

      expect(root1).not.toBe(root2);
      expect(fs.existsSync(path.join(root1, '1-UserGlobals', 'MyClass.gs'))).toBe(true);
      expect(fs.existsSync(path.join(root2, '1-UserGlobals', 'MyClass.gs'))).toBe(true);
    });
  });

  describe('userManagedDictionaries', () => {
    it('skips exporting user-managed dictionaries', async () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('userManagedDictionaries', ['UserGlobals']);

      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      // UserGlobals should NOT be exported
      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals'))).toBe(false);
      // Globals should still be exported
      expect(fs.existsSync(path.join(sessionRoot, '2-Globals', 'Array.gs'))).toBe(true);
      expect(fs.existsSync(path.join(sessionRoot, '2-Globals', 'String.gs'))).toBe(true);
    });

    it('does not call getClassNames for user-managed dictionaries', async () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('userManagedDictionaries', ['UserGlobals']);

      const session = createMockSession();
      await manager.exportSession(session);

      // getClassNames should only be called for Globals (dictIndex 2), not UserGlobals (dictIndex 1)
      expect(queries.getClassNames).not.toHaveBeenCalledWith(session, 1);
      expect(queries.getClassNames).toHaveBeenCalledWith(session, 2);
    });

    it('preserves user-managed directories during stale cleanup', async () => {
      const session = createMockSession();
      const sessionRoot = manager.getSessionRoot(session)!;

      // Pre-create a user-managed directory
      const managedDir = path.join(sessionRoot, '1-UserGlobals');
      fs.mkdirSync(managedDir, { recursive: true });
      fs.writeFileSync(path.join(managedDir, 'MyClass.gs'), 'user content');

      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('userManagedDictionaries', ['UserGlobals']);

      // Export with UserGlobals managed — it should not be deleted
      await manager.exportSession(session);

      expect(fs.existsSync(managedDir)).toBe(true);
      expect(fs.readFileSync(path.join(managedDir, 'MyClass.gs'), 'utf-8')).toBe('user content');
    });

    it('does not change permissions on user-managed directories', async () => {
      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;

      // Pre-create a user-managed directory with a file
      const managedDir = path.join(sessionRoot, '3-MyApp');
      fs.mkdirSync(managedDir, { recursive: true });
      const filePath = path.join(managedDir, 'Widget.gs');
      fs.writeFileSync(filePath, 'user content');
      fs.chmodSync(filePath, 0o644);

      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('userManagedDictionaries', ['MyApp']);

      // markReadOnly should skip managed directories
      manager.markReadOnly(session);

      const stat = fs.statSync(filePath);
      // Owner write bit should still be set
      expect(stat.mode & 0o200).not.toBe(0);
    });

    it('exports all dictionaries when list is empty', async () => {
      // Default: empty list
      const session = createMockSession();
      await manager.exportSession(session);

      const sessionRoot = manager.getSessionRoot(session)!;
      expect(fs.existsSync(path.join(sessionRoot, '1-UserGlobals', 'MyClass.gs'))).toBe(true);
      expect(fs.existsSync(path.join(sessionRoot, '2-Globals', 'Array.gs'))).toBe(true);
    });
  });

  describe('per-login exportPath template', () => {
    it('getResolvedTemplate uses login exportPath when set', () => {
      const session = createMockSession({ exportPath: '{workspaceRoot}/smalltalk/{dictName}' });
      const template = manager.getResolvedTemplate(session);
      expect(template).toBe(path.join(tmpDir, 'smalltalk', '{dictName}'));
    });

    it('getResolvedTemplate falls back to default when login exportPath is empty', () => {
      const session = createMockSession();
      const template = manager.getResolvedTemplate(session);
      expect(template).toBe(path.join(tmpDir, 'gemstone', 'localhost', 'gs64stone', 'DataCurator', '{index}-{dictName}'));
    });

    it('getResolvedTemplate resolves {host}, {stone}, {user} variables', () => {
      const session = createMockSession({
        exportPath: '{workspaceRoot}/exports/{host}/{stone}/{user}/{dictName}',
        gem_host: 'myhost',
        stone: 'mystone',
        gs_user: 'myuser',
      });
      const template = manager.getResolvedTemplate(session);
      expect(template).toBe(path.join(tmpDir, 'exports', 'myhost', 'mystone', 'myuser', '{dictName}'));
    });

    it('getResolvedTemplate handles relative login exportPath', () => {
      const session = createMockSession({ exportPath: 'smalltalk/{dictName}' });
      const template = manager.getResolvedTemplate(session);
      expect(template).toBe(path.join(tmpDir, 'smalltalk', '{dictName}'));
    });

    it('getResolvedTemplate returns undefined for relative path with no workspace', () => {
      const wsModule = vscode.workspace as unknown as { workspaceFolders: null };
      wsModule.workspaceFolders = null;
      const session = createMockSession({ exportPath: 'smalltalk/{dictName}' });
      expect(manager.getResolvedTemplate(session)).toBeUndefined();
    });

    it('getDictPath fully resolves the template', () => {
      const session = createMockSession({ exportPath: '{workspaceRoot}/smalltalk/{dictName}' });
      const dictPath = manager.getDictPath(session, 1, 'UserGlobals');
      expect(dictPath).toBe(path.join(tmpDir, 'smalltalk', 'UserGlobals'));
    });

    it('getDictPath resolves {index} in template', () => {
      const session = createMockSession({ exportPath: '{workspaceRoot}/code/{index}-{dictName}' });
      const dictPath = manager.getDictPath(session, 3, 'Published');
      expect(dictPath).toBe(path.join(tmpDir, 'code', '3-Published'));
    });

    it('getSessionRoot returns parent of dict directories', () => {
      const session = createMockSession({ exportPath: '{workspaceRoot}/smalltalk/{dictName}' });
      const root = manager.getSessionRoot(session);
      expect(root).toBe(path.join(tmpDir, 'smalltalk'));
    });

    it('exports to custom paths using login exportPath', async () => {
      const session = createMockSession({ exportPath: '{workspaceRoot}/smalltalk/{dictName}' });
      await manager.exportSession(session);

      const root = manager.getSessionRoot(session)!;
      expect(fs.existsSync(path.join(root, 'UserGlobals', 'MyClass.gs'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'UserGlobals', 'OtherClass.gs'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'Globals', 'Array.gs'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'Globals', 'String.gs'))).toBe(true);
    });

    it('uses global exportPath as root when login has no exportPath', () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('exportPath', '{workspaceRoot}/my-exports');
      const session = createMockSession();
      const root = manager.getSessionRoot(session);
      expect(root).toBe(path.join(tmpDir, 'my-exports', 'localhost', 'gs64stone', 'DataCurator'));
    });

    it('login exportPath takes precedence over global exportPath', () => {
      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('exportPath', '{workspaceRoot}/global-exports');
      const session = createMockSession({ exportPath: '{workspaceRoot}/login-exports/{dictName}' });
      const root = manager.getSessionRoot(session);
      expect(root).toBe(path.join(tmpDir, 'login-exports'));
    });

    it('preserves user-managed directories with plain dict names', async () => {
      const session = createMockSession({ exportPath: '{workspaceRoot}/smalltalk/{dictName}' });
      const root = manager.getSessionRoot(session)!;

      // Pre-create a user-managed directory
      const managedDir = path.join(root, 'UserGlobals');
      fs.mkdirSync(managedDir, { recursive: true });
      fs.writeFileSync(path.join(managedDir, 'MyClass.gs'), 'user content');

      const mockVscode = vscode as unknown as { __setConfigValue: (key: string, value: unknown) => void };
      mockVscode.__setConfigValue('userManagedDictionaries', ['UserGlobals']);

      await manager.exportSession(session);

      expect(fs.existsSync(managedDir)).toBe(true);
      expect(fs.readFileSync(path.join(managedDir, 'MyClass.gs'), 'utf-8')).toBe('user content');
    });
  });
});
