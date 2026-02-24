import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    constructor(message: string, public readonly gciErrorNumber: number = 0) {
      super(message);
    }
  },
  fileOutClass: vi.fn((_s: unknown, _d: number, className: string) => {
    return `! fileout of ${className}\n`;
  }),
}));

vi.mock('../topazFileIn', () => ({
  fileInClass: vi.fn(() => ({
    success: true,
    errors: [],
    compiledMethods: 2,
    compiledClassDef: true,
  })),
}));

import * as vscode from 'vscode';
import { ReconcileManager, ReconcileContentProvider } from '../reconcileManager';
import { ExportManager } from '../exportManager';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';
import { fileInClass } from '../topazFileIn';

function createMockSession(): ActiveSession {
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
    },
    stoneVersion: '3.7.2',
  };
}

function createMockExportManager(sessionRoot: string | undefined): ExportManager {
  return {
    getSessionRoot: vi.fn(() => sessionRoot),
    getExportRoot: vi.fn(() => sessionRoot ? path.dirname(path.dirname(path.dirname(sessionRoot))) : undefined),
    exportSession: vi.fn(),
    isWriting: false,
  } as unknown as ExportManager;
}

describe('ReconcileContentProvider', () => {
  it('stores and retrieves content by key', () => {
    const provider = new ReconcileContentProvider();
    const uri = provider.setContent('1. UserGlobals/MyClass', 'class content');
    expect(provider.provideTextDocumentContent(uri)).toBe('class content');
  });

  it('returns empty string for unknown key', () => {
    const provider = new ReconcileContentProvider();
    const uri = vscode.Uri.parse('gemstone-reconcile://compare/unknown');
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });

  it('clears all content', () => {
    const provider = new ReconcileContentProvider();
    provider.setContent('key', 'content');
    provider.clear();
    const uri = vscode.Uri.parse('gemstone-reconcile://compare/key');
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });
});

describe('ReconcileManager', () => {
  let tmpDir: string;
  let sessionRoot: string;
  let manager: ReconcileManager;
  let mockExportManager: ExportManager;
  let session: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    (queries.fileOutClass as ReturnType<typeof vi.fn>).mockImplementation(
      (_s: unknown, _d: number, className: string) => `! fileout of ${className}\n`,
    );
    (fileInClass as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      errors: [],
      compiledMethods: 2,
      compiledClassDef: true,
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));
    sessionRoot = path.join(tmpDir, 'localhost', 'gs64stone', 'DataCurator');
    session = createMockSession();
    mockExportManager = createMockExportManager(sessionRoot);
    manager = new ReconcileManager(mockExportManager);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('reconcileOrExport', () => {
    it('calls exportSession when no session root exists', async () => {
      mockExportManager = createMockExportManager(undefined);
      manager = new ReconcileManager(mockExportManager);

      await manager.reconcileOrExport(session, true);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(session, true);
    });

    it('calls exportSession when session root has no .gs files', async () => {
      fs.mkdirSync(sessionRoot, { recursive: true });
      fs.mkdirSync(path.join(sessionRoot, '1. UserGlobals'), { recursive: true });
      // Directory exists but no .gs files

      await manager.reconcileOrExport(session, true);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(session, true);
    });

    it('calls exportSession when all files match GemStone', async () => {
      // Create local file that matches what GemStone returns
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), '! fileout of MyClass\n');

      await manager.reconcileOrExport(session, true);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(session, true);
      // No dialog should have been shown
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('shows summary dialog when files differ', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      // Mock the dialog to return "Skip"
      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Skip');

      await manager.reconcileOrExport(session, true);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('1 file'),
        'Use GemStone',
        'Use Local',
        'Show Differences',
        'Skip',
      );
    });

    it('"Use GemStone" calls exportSession', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Use GemStone');

      await manager.reconcileOrExport(session, true);

      expect(mockExportManager.exportSession).toHaveBeenCalledWith(session, true);
    });

    it('"Use Local" calls fileInClass for each diff then exportSession', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Use Local');

      await manager.reconcileOrExport(session, true);

      expect(fileInClass).toHaveBeenCalledWith(session, 'local version\n');
      expect(mockExportManager.exportSession).toHaveBeenCalledWith(session, true);
    });

    it('"Skip" does not call exportSession or fileInClass', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Skip');

      await manager.reconcileOrExport(session, true);

      expect(mockExportManager.exportSession).not.toHaveBeenCalled();
      expect(fileInClass).not.toHaveBeenCalled();
    });

    it('dismissed dialog does not call exportSession or fileInClass', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue(undefined);

      await manager.reconcileOrExport(session, true);

      expect(mockExportManager.exportSession).not.toHaveBeenCalled();
      expect(fileInClass).not.toHaveBeenCalled();
    });

    it('"Use Local" with file-in errors shows warning and still exports', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Use Local');
      (fileInClass as ReturnType<typeof vi.fn>).mockReturnValue({
        success: false,
        errors: [{ message: 'Syntax error', line: 3 }],
        compiledMethods: 0,
        compiledClassDef: false,
      });

      await manager.reconcileOrExport(session, true);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
      );
      expect(mockExportManager.exportSession).toHaveBeenCalledWith(session, true);
    });

    it('parses dictionary index from directory name', async () => {
      // Create directories with various numbered formats
      const dict1 = path.join(sessionRoot, '1. UserGlobals');
      const dict3 = path.join(sessionRoot, '3. Published');
      fs.mkdirSync(dict1, { recursive: true });
      fs.mkdirSync(dict3, { recursive: true });
      fs.writeFileSync(path.join(dict1, 'MyClass.gs'), 'local version\n');
      fs.writeFileSync(path.join(dict3, 'OtherClass.gs'), 'local version\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Skip');

      await manager.reconcileOrExport(session, true);

      // fileOutClass should have been called with dictIndex 1 and 3
      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 1, 'MyClass');
      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 3, 'OtherClass');
    });

    it('counts local-only files when GCI call fails', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'DeletedClass.gs'), 'old content\n');
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      // DeletedClass fails (no longer at that index), MyClass differs
      (queries.fileOutClass as ReturnType<typeof vi.fn>).mockImplementation(
        (_s: unknown, _d: number, className: string) => {
          if (className === 'DeletedClass') throw new Error('not found');
          return `! fileout of ${className}\n`; // differs from "local version"
        },
      );

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Skip');

      await manager.reconcileOrExport(session, true);

      // Summary should mention both the diff AND the local-only file
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('1 file differ'),
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      );
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('1 local file'),
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      );
    });

    it('ignores directories without numeric prefix', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      const otherDir = path.join(sessionRoot, 'notes');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.mkdirSync(otherDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), '! fileout of MyClass\n');
      fs.writeFileSync(path.join(otherDir, 'stuff.gs'), 'not a class\n');

      await manager.reconcileOrExport(session, true);

      // Should only compare the numbered directory file
      expect(queries.fileOutClass).toHaveBeenCalledTimes(1);
      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 1, 'MyClass');
      // All matched — should export, no dialog
      expect(mockExportManager.exportSession).toHaveBeenCalled();
    });

    it('"Show Differences" shows QuickPick then batch dialog', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'MyClass.gs'), 'local version\n');

      // First dialog: "Show Differences"
      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Show Differences')
        // Batch action dialog after Escape from QuickPick
        .mockResolvedValueOnce('Skip');

      // QuickPick: user presses Escape (returns undefined)
      (vscode.window.showQuickPick as ReturnType<typeof vi.fn>)
        .mockResolvedValue(undefined);

      await manager.reconcileOrExport(session, true);

      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      // Second dialog (batch action) should have been shown
      expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
    });

    it('handles multiple differing files', async () => {
      const dictDir = path.join(sessionRoot, '1. UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      fs.writeFileSync(path.join(dictDir, 'ClassA.gs'), 'local A\n');
      fs.writeFileSync(path.join(dictDir, 'ClassB.gs'), 'local B\n');

      (vscode.window.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValue('Use Local');

      await manager.reconcileOrExport(session, true);

      expect(fileInClass).toHaveBeenCalledTimes(2);
      expect(mockExportManager.exportSession).toHaveBeenCalled();
    });
  });
});
