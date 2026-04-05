import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('child_process');
vi.mock('fs');

import { exec } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { OsConfigTreeProvider } from '../sharedMemoryTreeProvider';

// ── Helpers ────────────────────────────────────────────────

const LINUX_SHMMAX_4GB = 4294967296;
const LINUX_SHMALL_4GB = 1048576;
const LINUX_SYSCTL_4GB = `kernel.shmmax = ${LINUX_SHMMAX_4GB}\nkernel.shmall = ${LINUX_SHMALL_4GB}\n`;
const LINUX_SYSCTL_UNLIMITED = 'kernel.shmmax = 18446744073692774399\nkernel.shmall = 18446744073692774399\n';
const LINUX_SYSCTL_1GB = 'kernel.shmmax = 1073741824\nkernel.shmall = 262144\n';
const LINUX_SYSCTL_SMALL = 'kernel.shmmax = 4194304\nkernel.shmall = 1024\n'; // 4 MB / 4 MB

const MACOS_SYSCTL_4GB = `kern.sysv.shmmax: ${LINUX_SHMMAX_4GB}\nkern.sysv.shmall: ${LINUX_SHMALL_4GB}\n`;
const MACOS_SYSCTL_1GB = 'kern.sysv.shmmax: 1073741824\nkern.sysv.shmall: 262144\n';
const MACOS_SYSCTL_SMALL = 'kern.sysv.shmmax: 4194304\nkern.sysv.shmall: 1024\n'; // 4 MB / 4 MB

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeContext() {
  return {
    extensionPath: '/ext',
    subscriptions: { push: vi.fn() },
  } as unknown as vscode.ExtensionContext;
}

/** Retrieve the callback registered for a command by name. */
function getCommand(commandId: string): (() => void) | undefined {
  const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
  const call = calls.find(([id]) => id === commandId);
  return call?.[1] as (() => void) | undefined;
}

/** Make exec call its callback immediately with the given stdout output. */
function mockExec(output: string): void {
  vi.mocked(exec as any).mockImplementation((_cmd: any, _opts: any, cb: any) => {
    cb(null, output, '');
  });
}

/** Make exec call its callback with an error (simulates sysctl not found). */
function mockExecError(): void {
  vi.mocked(exec as any).mockImplementation((_cmd: any, _opts: any, cb: any) => {
    cb(new Error('command not found'), '', '');
  });
}

/** Call getChildren(), wait for async load to complete, then return cached nodes. */
async function getRootNodes(provider: OsConfigTreeProvider): Promise<any[]> {
  const initial = provider.getChildren();
  if (Array.isArray(initial) && initial.length === 1 && initial[0].kind === 'loading') {
    // Wait for the async _loadConfig to fire onDidChangeTreeData
    await new Promise<void>((resolve) => {
      const disposable = provider.onDidChangeTreeData(() => {
        disposable.dispose();
        resolve();
      });
    });
    return provider.getChildren() as any[];
  }
  return (Array.isArray(initial) ? initial : await initial) as any[];
}

// ── Suite ──────────────────────────────────────────────────

describe('OsConfigTreeProvider', () => {
  let provider: OsConfigTreeProvider;
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = process.platform;
    provider = new OsConfigTreeProvider();

    // Default: sysctl succeeds with empty output, no logind files
    mockExec('');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(vscode.commands.registerCommand).mockClear();
    vi.mocked(vscode.window.createTerminal).mockReturnValue({ show: vi.fn(), sendText: vi.fn() } as any);
    vi.mocked(vscode.window.showInformationMessage).mockClear();
    vi.mocked(vscode.window.onDidCloseTerminal).mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  // ── refresh ──────────────────────────────────────────────

  describe('refresh', () => {
    it('fires onDidChangeTreeData', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalledWith(undefined);
    });

    it('clears the cache so getChildren re-fetches', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      await getRootNodes(provider); // populate cache

      // Change mock — without refresh, cache would still return old data
      mockExec(MACOS_SYSCTL_SMALL);
      provider.refresh();
      const nodes = await getRootNodes(provider);
      expect((nodes[0] as any).configured).toBe(false);
    });
  });

  // ── getChildren — top-level ───────────────────────────────

  describe('getChildren (top-level)', () => {
    it('returns a loading node before async data is ready', () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      const nodes = provider.getChildren() as any[];
      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe('loading');
    });

    it('on macOS returns only a sharedMemoryStatus node', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      const nodes = await getRootNodes(provider);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe('sharedMemoryStatus');
    });

    it('on Linux returns sharedMemoryStatus and removeIpcStatus', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      const nodes = await getRootNodes(provider);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].kind).toBe('sharedMemoryStatus');
      expect(nodes[1].kind).toBe('removeIpcStatus');
    });

    it('returns sharedMemoryStatus configured=true when shmmax and shmall >= 1 GB (Linux)', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_1GB);
      const [node] = await getRootNodes(provider);
      expect(node).toMatchObject({ kind: 'sharedMemoryStatus', configured: true });
    });

    it('returns sharedMemoryStatus configured=false when shmmax < 1 GB (macOS)', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_SMALL);
      const [node] = await getRootNodes(provider);
      expect(node).toMatchObject({ kind: 'sharedMemoryStatus', configured: false });
    });

    it('returns sharedMemoryStatus configured=false when exec errors', async () => {
      setPlatform('darwin');
      mockExecError();
      const [node] = await getRootNodes(provider);
      expect(node).toMatchObject({ kind: 'sharedMemoryStatus', configured: false, gbLabel: '0' });
    });

    it('labels large Linux default shmmax as "≥ 1"', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_UNLIMITED);
      const [node] = await getRootNodes(provider);
      expect(node.gbLabel).toBe('≥ 1');
    });

    it('labels exact 1 GB shmmax as "1"', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_1GB);
      const [node] = await getRootNodes(provider);
      expect(node.gbLabel).toBe('1');
    });

    it('removeIpcStatus configured=false when no logind.conf', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      const nodes = await getRootNodes(provider);
      const removeIpc = nodes.find((n: any) => n.kind === 'removeIpcStatus') as any;
      expect(removeIpc.configured).toBe(false);
    });

    it('removeIpcStatus configured=true when logind.conf has RemoveIPC=no', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockReturnValue('[Login]\nRemoveIPC=no\n' as any);
      const nodes = await getRootNodes(provider);
      const removeIpc = nodes.find((n: any) => n.kind === 'removeIpcStatus') as any;
      expect(removeIpc.configured).toBe(true);
    });

    it('removeIpcStatus configured=false when logind.conf has RemoveIPC=yes', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockReturnValue('[Login]\nRemoveIPC=yes\n' as any);
      const nodes = await getRootNodes(provider);
      const removeIpc = nodes.find((n: any) => n.kind === 'removeIpcStatus') as any;
      expect(removeIpc.configured).toBe(false);
    });

    it('ignores commented-out RemoveIPC lines', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.readFileSync).mockReturnValue('# RemoveIPC=no\n' as any);
      const nodes = await getRootNodes(provider);
      const removeIpc = nodes.find((n: any) => n.kind === 'removeIpcStatus') as any;
      expect(removeIpc.configured).toBe(false);
    });

    it('drop-in file overrides main logind.conf (last wins)', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['gemstone.conf'] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filepath: any) => {
        if (String(filepath).endsWith('logind.conf') && !String(filepath).includes('.d/')) {
          return 'RemoveIPC=yes\n' as any; // main file says yes
        }
        return '[Login]\nRemoveIPC=no\n' as any; // drop-in overrides to no
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = nodes.find((n: any) => n.kind === 'removeIpcStatus') as any;
      expect(removeIpc.configured).toBe(true);
    });

    it('main logind.conf wins when drop-in sets it back to yes', async () => {
      setPlatform('linux');
      mockExec(LINUX_SYSCTL_4GB);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['zz-override.conf'] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filepath: any) => {
        if (String(filepath).includes('.d/')) {
          return 'RemoveIPC=yes\n' as any;
        }
        return 'RemoveIPC=no\n' as any;
      });
      const nodes = await getRootNodes(provider);
      const removeIpc = nodes.find((n: any) => n.kind === 'removeIpcStatus') as any;
      expect(removeIpc.configured).toBe(false);
    });

    it('returns cached nodes on second call without re-running exec', async () => {
      setPlatform('darwin');
      mockExec(MACOS_SYSCTL_4GB);
      await getRootNodes(provider);
      mockExec(''); // change mock — cache should prevent this from being used
      const nodes = provider.getChildren() as any[];
      expect((nodes[0] as any).configured).toBe(true);
    });
  });

  // ── getChildren — action nodes ────────────────────────────

  describe('getChildren (action nodes)', () => {
    it('sharedMemoryStatus not configured on Linux returns one action', async () => {
      setPlatform('linux');
      const parent = { kind: 'sharedMemoryStatus' as const, configured: false, gbLabel: '1' };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ kind: 'action', command: 'gemstone.runSetSharedMemoryLinux' });
    });

    it('sharedMemoryStatus not configured on macOS returns one action', async () => {
      setPlatform('darwin');
      const parent = { kind: 'sharedMemoryStatus' as const, configured: false, gbLabel: '0' };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ kind: 'action', command: 'gemstone.runSetSharedMemory' });
    });

    it('sharedMemoryStatus configured returns no children', async () => {
      const parent = { kind: 'sharedMemoryStatus' as const, configured: true, gbLabel: '4' };
      expect(await provider.getChildren(parent)).toHaveLength(0);
    });

    it('removeIpcStatus not configured returns two actions', async () => {
      const parent = { kind: 'removeIpcStatus' as const, configured: false };
      const children = await provider.getChildren(parent);
      expect(children).toHaveLength(2);
      expect(children[0]).toMatchObject({ kind: 'action', command: 'gemstone.runSetRemoveIPC' });
      expect(children[1]).toMatchObject({ kind: 'action', command: 'gemstone.removeIpcInfo' });
    });

    it('removeIpcStatus configured returns no children', async () => {
      const parent = { kind: 'removeIpcStatus' as const, configured: true };
      expect(await provider.getChildren(parent)).toHaveLength(0);
    });
  });

  // ── getTreeItem ───────────────────────────────────────────

  describe('getTreeItem', () => {
    describe('loading', () => {
      it('shows a spinning loading icon', () => {
        const item = provider.getTreeItem({ kind: 'loading' });
        expect(item.label).toContain('Checking');
        expect((item.iconPath as any).id).toBe('loading~spin');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      });
    });

    describe('sharedMemoryStatus', () => {
      it('configured: check icon, None collapsible state, label includes gbLabel', () => {
        const item = provider.getTreeItem({ kind: 'sharedMemoryStatus', configured: true, gbLabel: '4' });
        expect(item.label).toContain('4');
        expect(item.label).toContain('configured');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
        expect((item.iconPath as any).id).toBe('check');
      });

      it('not configured: warning icon, Expanded state, tooltip set', () => {
        const item = provider.getTreeItem({ kind: 'sharedMemoryStatus', configured: false, gbLabel: '1' });
        expect(item.label).toContain('not configured');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
        expect((item.iconPath as any).id).toBe('warning');
        expect(item.tooltip).toBeTruthy();
      });

      it('uses "≥ 1" gbLabel in label', () => {
        const item = provider.getTreeItem({ kind: 'sharedMemoryStatus', configured: true, gbLabel: '≥ 1' });
        expect(item.label).toContain('≥ 1');
      });
    });

    describe('removeIpcStatus', () => {
      it('configured: check icon, None state, no tooltip', () => {
        const item = provider.getTreeItem({ kind: 'removeIpcStatus', configured: true });
        expect(item.label).toContain('configured');
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
        expect((item.iconPath as any).id).toBe('check');
        expect(item.tooltip).toBeUndefined();
      });

      it('not configured: warning icon, Expanded state, tooltip explains risk', () => {
        const item = provider.getTreeItem({ kind: 'removeIpcStatus', configured: false });
        expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
        expect((item.iconPath as any).id).toBe('warning');
        expect(String(item.tooltip)).toMatch(/shared memory|IPC/i);
      });
    });

    describe('action nodes', () => {
      it('runSetSharedMemory: terminal icon', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'Run', command: 'gemstone.runSetSharedMemory' });
        expect((item.iconPath as any).id).toBe('terminal');
      });

      it('runSetSharedMemoryLinux: terminal icon, mentions no restart in tooltip', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'Run', command: 'gemstone.runSetSharedMemoryLinux' });
        expect((item.iconPath as any).id).toBe('terminal');
        expect(String(item.tooltip)).toMatch(/no restart/i);
      });

      it('runSetSharedMemory: terminal icon, mentions no restart in tooltip', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'Run', command: 'gemstone.runSetSharedMemory' });
        expect((item.iconPath as any).id).toBe('terminal');
        expect(String(item.tooltip)).toMatch(/no restart/i);
      });

      it('runSetRemoveIPC: terminal icon', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'Run', command: 'gemstone.runSetRemoveIPC' });
        expect((item.iconPath as any).id).toBe('terminal');
      });

      it('sharedMemoryInfo: info icon', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'Info', command: 'gemstone.sharedMemoryInfo' });
        expect((item.iconPath as any).id).toBe('info');
      });

      it('removeIpcInfo: info icon, tooltip mentions systemd-logind', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'Info', command: 'gemstone.removeIpcInfo' });
        expect((item.iconPath as any).id).toBe('info');
        expect(String(item.tooltip)).toMatch(/systemd-logind/);
      });

      it('sets item.command with command id and title', () => {
        const item = provider.getTreeItem({ kind: 'action', text: 'My Label', command: 'gemstone.runSetRemoveIPC' });
        expect(item.command).toEqual({ command: 'gemstone.runSetRemoveIPC', title: 'My Label' });
      });
    });
  });

  // ── registerCommands ─────────────────────────────────────

  describe('registerCommands', () => {
    it('registers all five commands', () => {
      provider.registerCommands(makeContext());
      const registeredIds = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
      expect(registeredIds).toContain('gemstone.runSetSharedMemory');
      expect(registeredIds).toContain('gemstone.runSetSharedMemoryLinux');
      expect(registeredIds).toContain('gemstone.runSetRemoveIPC');
      expect(registeredIds).toContain('gemstone.sharedMemoryInfo');
      expect(registeredIds).toContain('gemstone.removeIpcInfo');
    });

    it('runSetSharedMemory opens a terminal and sends the macOS script path', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);

      getCommand('gemstone.runSetSharedMemory')?.();

      expect(vscode.window.createTerminal).toHaveBeenCalledWith('GemStone: Shared Memory Setup');
      expect(mockTerminal.show).toHaveBeenCalled();
      expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringContaining('setSharedMemory.sh'));
      expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringMatching(/&& exit$/));
    });

    it('runSetSharedMemoryLinux opens a terminal and sends the Linux script path', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);

      getCommand('gemstone.runSetSharedMemoryLinux')?.();

      expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringContaining('setSharedMemoryLinux.sh'));
    });

    it('runSetRemoveIPC opens a terminal and sends the RemoveIPC script path', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);

      getCommand('gemstone.runSetRemoveIPC')?.();

      expect(vscode.window.createTerminal).toHaveBeenCalledWith('GemStone: RemoveIPC Setup');
      expect(mockTerminal.sendText).toHaveBeenCalledWith(expect.stringContaining('setRemoveIPC.sh'));
    });

    it('sharedMemoryInfo shows an information message', () => {
      provider.registerCommands(makeContext());
      getCommand('gemstone.sharedMemoryInfo')?.();
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });

    it('removeIpcInfo shows an information message mentioning systemd-logind', () => {
      provider.registerCommands(makeContext());
      getCommand('gemstone.removeIpcInfo')?.();
      const msg = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
      expect(msg).toMatch(/systemd-logind/);
    });

    it('runSetSharedMemory refreshes the panel when the terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetSharedMemory')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (t: unknown) => void;

      closeListener(mockTerminal);
      expect(refreshSpy).toHaveBeenCalledOnce();
    });

    it('runSetSharedMemoryLinux refreshes the panel when the terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetSharedMemoryLinux')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (t: unknown) => void;

      closeListener(mockTerminal);
      expect(refreshSpy).toHaveBeenCalledOnce();
    });

    it('runSetRemoveIPC refreshes the panel when the terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetRemoveIPC')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (t: unknown) => void;

      closeListener(mockTerminal);
      expect(refreshSpy).toHaveBeenCalledOnce();
    });

    it('does not refresh when a different terminal closes', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);
      const refreshSpy = vi.spyOn(provider, 'refresh');

      getCommand('gemstone.runSetSharedMemory')?.();
      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock.calls[0][0] as (t: unknown) => void;

      closeListener({ show: vi.fn(), sendText: vi.fn() }); // different terminal
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('runSetSharedMemoryLinux script path does not match macOS script', () => {
      provider.registerCommands(makeContext());
      const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);

      getCommand('gemstone.runSetSharedMemoryLinux')?.();
      const [linuxCmd] = mockTerminal.sendText.mock.calls[0];

      mockTerminal.sendText.mockClear();
      vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);
      getCommand('gemstone.runSetSharedMemory')?.();
      const [macCmd] = mockTerminal.sendText.mock.calls[0];

      expect(linuxCmd).not.toBe(macCmd);
    });
  });
});
