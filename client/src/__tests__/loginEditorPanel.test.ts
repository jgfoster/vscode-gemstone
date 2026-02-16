import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { window, __resetConfig } from '../__mocks__/vscode';
import { LoginEditorPanel } from '../loginEditorPanel';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider } from '../loginTreeProvider';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
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

    it('creates a panel titled with login label when editing', () => {
      const login = makeLogin({ label: 'Production' });
      LoginEditorPanel.show(storage, treeProvider, login);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneLoginEditor',
        'Edit: Production',
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
      expect(html).toContain('id="label"');
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
      });
    });

    it('sends existing login data when editing', () => {
      const login = makeLogin({ label: 'Server', gem_host: 'myhost' });
      LoginEditorPanel.show(storage, treeProvider, login);
      const panel = (window.createWebviewPanel as any).mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadData',
        data: expect.objectContaining({ label: 'Server', gem_host: 'myhost' }),
      });
    });
  });
});
