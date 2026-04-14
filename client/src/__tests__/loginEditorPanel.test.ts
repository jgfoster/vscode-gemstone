import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../sysadminStorage');

const keytarMock = {
  getPassword: vi.fn(() => Promise.resolve(null as string | null)),
  setPassword: vi.fn(() => Promise.resolve()),
  deletePassword: vi.fn(() => Promise.resolve(true)),
};
vi.mock('keytar', () => ({ default: keytarMock }));

import { window, __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginEditorPanel } from '../loginEditorPanel';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider } from '../loginTreeProvider';
import { SysadminStorage } from '../sysadminStorage';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
}

function makeSysadminStorage(extractedVersions: string[] = []): SysadminStorage {
  return {
    getExtractedVersions: vi.fn(() => extractedVersions),
  } as any;
}

describe('LoginEditorPanel', () => {
  let storage: LoginStorage;
  let treeProvider: LoginTreeProvider;

  beforeEach(() => {
    __resetConfig();
    storage = new LoginStorage();
    treeProvider = new LoginTreeProvider(storage);
    // Reset the static currentPanel between tests
    (LoginEditorPanel as any).currentPanel = undefined;
    vi.clearAllMocks();
    keytarMock.getPassword.mockResolvedValue(null);
    keytarMock.setPassword.mockResolvedValue(undefined);
    keytarMock.deletePassword.mockResolvedValue(true);
  });

  describe('show', () => {
    it('creates a new webview panel for a new login', () => {
      LoginEditorPanel.show(storage, treeProvider);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneLoginEditor',
        'New GemStone Login',
        expect.any(Number),
        expect.objectContaining({ enableScripts: true }),
      );
    });

    it('creates a panel titled with login description when editing', () => {
      const login = makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db.example.com' });
      LoginEditorPanel.show(storage, treeProvider, login);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneLoginEditor',
        'Edit: Admin on prod (db.example.com)',
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('reuses existing panel on subsequent calls', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const firstCallCount = (window.createWebviewPanel as any).mock.calls.length;

      LoginEditorPanel.show(storage, treeProvider, makeLogin({ label: 'Second' }));
      expect((window.createWebviewPanel as any).mock.calls.length).toBe(firstCallCount);
    });

    it('reveals existing panel on subsequent calls', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;

      LoginEditorPanel.show(storage, treeProvider, makeLogin({ label: 'Second' }));
      expect(panel.reveal).toHaveBeenCalled();
    });
  });

  describe('webview HTML', () => {
    it('sets webview html with form fields', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('GemStone Login Parameters');
      expect(html).toContain('id="version"');
      expect(html).toContain('id="gem_host"');
      expect(html).toContain('id="stone"');
      expect(html).toContain('id="gs_user"');
      expect(html).toContain('id="gs_password"');
      expect(html).toContain('id="netldi"');
      expect(html).toContain('id="host_user"');
      expect(html).toContain('id="host_password"');
    });

    it('includes Content-Security-Policy with nonce', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('Content-Security-Policy');
      expect(html).toMatch(/nonce-[a-f0-9]{32}/);
    });

    it('includes save and cancel buttons', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('id="saveBtn"');
      expect(html).toContain('id="cancelBtn"');
    });

  });

  describe('message handling', () => {
    it('sends loadData message after creating panel', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadData',
        data: expect.objectContaining({ label: '' }),
        versions: [],
      });
    });

    it('sends existing login data when editing', () => {
      const login = makeLogin({ label: 'Server', gem_host: 'myhost' });
      LoginEditorPanel.show(storage, treeProvider, login);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadData',
        data: expect.objectContaining({ label: 'Server', gem_host: 'myhost' }),
        versions: [],
      });
    });
  });

  describe('version dropdown', () => {
    it('includes extracted versions in loadData message', () => {
      const sysadmin = makeSysadminStorage(['3.7.4', '3.6.4']);
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4', '3.6.4'] }),
      );
    });

    it('includes versions from gciLibraries config', () => {
      __setConfig('gemstone', 'gciLibraries', { '3.5.0': '/path/to/lib' });
      const sysadmin = makeSysadminStorage([]);
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.5.0'] }),
      );
    });

    it('deduplicates versions from both sources', () => {
      __setConfig('gemstone', 'gciLibraries', { '3.7.4': '/path/to/lib' });
      const sysadmin = makeSysadminStorage(['3.7.4']);
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4'] }),
      );
    });

    it('sorts versions newest first', () => {
      __setConfig('gemstone', 'gciLibraries', { '3.5.0': '/path/a' });
      const sysadmin = makeSysadminStorage(['3.6.4', '3.7.4']);
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4', '3.6.4', '3.5.0'] }),
      );
    });

    it('renders a select element for the version field', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.html).toContain('<select id="version">');
    });

    it('defaults new login version to the highest available version', () => {
      const sysadmin = makeSysadminStorage(['3.6.4', '3.7.4']);
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '3.7.4' }),
        }),
      );
    });

    it('defaults to empty version when no versions are available', () => {
      const sysadmin = makeSysadminStorage([]);
      LoginEditorPanel.show(storage, treeProvider, undefined, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '' }),
        }),
      );
    });

    it('preserves version from existing login rather than defaulting', () => {
      const sysadmin = makeSysadminStorage(['3.7.4', '3.6.4']);
      const login = makeLogin({ version: '3.6.4' });
      LoginEditorPanel.show(storage, treeProvider, login, sysadmin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '3.6.4' }),
        }),
      );
    });
  });

  describe('OS keychain option', () => {
    it('renders a "Store password in OS keychain" checkbox in the HTML', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('id="password_in_keychain"');
      expect(html).toContain('Store password in OS keychain');
    });

    it('renders a hint about leaving the password blank to be prompted', () => {
      LoginEditorPanel.show(storage, treeProvider);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.html).toContain('Leave password blank to be prompted on each login');
    });

    it('pre-fills password from keychain when editing a keychain-backed login', async () => {
      keytarMock.getPassword.mockResolvedValue('kc-secret');
      const login = makeLogin({
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: '',
        password_in_keychain: true,
      });

      await LoginEditorPanel.show(storage, treeProvider, login);

      expect(keytarMock.getPassword).toHaveBeenCalledWith(
        'jasper-gemstone-login',
        'DataCurator@localhost/gs64stone',
      );
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      const loadCall = (panel.webview.postMessage as any).mock.calls.find(
        (c: any[]) => c[0]?.command === 'loadData',
      );
      expect(loadCall?.[0].data.gs_password).toBe('kc-secret');
    });

    it('does not call keytar when editing a non-keychain login', async () => {
      const login = makeLogin({ gs_password: 'plain' });

      await LoginEditorPanel.show(storage, treeProvider, login);

      expect(keytarMock.getPassword).not.toHaveBeenCalled();
    });
  });

  describe('save with keychain checkbox', () => {
    async function simulateSave(
      existingLogin: GemStoneLogin | undefined,
      saveData: Partial<GemStoneLogin> & { password_in_keychain?: boolean },
    ) {
      await LoginEditorPanel.show(storage, treeProvider, existingLogin);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
      const data = { ...makeLogin(), ...saveData };
      await handler({ command: 'save', data, originalLabel: existingLogin?.label ?? null });
    }

    it('stores the password in the keychain and saves with empty gs_password', async () => {
      const saveSpy = vi.spyOn(storage, 'saveLogin').mockResolvedValue();

      await simulateSave(undefined, {
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: 'newpw',
        password_in_keychain: true,
      });

      expect(keytarMock.setPassword).toHaveBeenCalledWith(
        'jasper-gemstone-login',
        'DataCurator@localhost/gs64stone',
        'newpw',
      );
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.gs_password).toBe('');
      expect(saved.password_in_keychain).toBe(true);
    });

    it('deletes the keychain entry when unchecking the box', async () => {
      const existing = makeLogin({
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: '',
        password_in_keychain: true,
      });
      vi.spyOn(storage, 'saveLogin').mockResolvedValue();

      await simulateSave(existing, {
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: 'plain-now',
        password_in_keychain: false,
      });

      expect(keytarMock.deletePassword).toHaveBeenCalledWith(
        'jasper-gemstone-login',
        'DataCurator@localhost/gs64stone',
      );
    });

    it('does not touch the keychain when saving a plain-password login', async () => {
      vi.spyOn(storage, 'saveLogin').mockResolvedValue();

      await simulateSave(undefined, {
        gs_password: 'plainpw',
        password_in_keychain: false,
      });

      expect(keytarMock.setPassword).not.toHaveBeenCalled();
      expect(keytarMock.deletePassword).not.toHaveBeenCalled();
    });
  });
});
