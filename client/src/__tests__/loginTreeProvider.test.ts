import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider, GemStoneLoginItem } from '../loginTreeProvider';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
}

describe('LoginTreeProvider', () => {
  let storage: LoginStorage;
  let provider: LoginTreeProvider;

  beforeEach(() => {
    __resetConfig();
    storage = new LoginStorage();
    provider = new LoginTreeProvider(storage);
  });

  describe('getChildren', () => {
    it('returns empty array when no logins', () => {
      expect(provider.getChildren()).toEqual([]);
    });

    it('returns a GemStoneLoginItem for each login', () => {
      __setConfig('gemstone', 'logins', [
        makeLogin({ label: 'Dev' }),
        makeLogin({ label: 'Prod' }),
      ]);

      const items = provider.getChildren();
      expect(items).toHaveLength(2);
      expect(items[0]).toBeInstanceOf(GemStoneLoginItem);
      expect(items[1]).toBeInstanceOf(GemStoneLoginItem);
    });
  });

  describe('getTreeItem', () => {
    it('returns the element itself', () => {
      const item = new GemStoneLoginItem(makeLogin({ label: 'Server' }));
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });

  describe('refresh', () => {
    it('fires onDidChangeTreeData event', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);
      provider.refresh();
      expect(listener).toHaveBeenCalledWith(undefined);
    });
  });
});

describe('GemStoneLoginItem', () => {
  it('sets label from login fields', () => {
    const item = new GemStoneLoginItem(makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db.example.com' }));
    expect(item.label).toBe('Admin on prod (db.example.com)');
  });

  it('shows version as description', () => {
    const item = new GemStoneLoginItem(
      makeLogin({ gs_user: 'Admin', gem_host: 'db.example.com', version: '3.7.2' }),
    );
    expect(item.description).toBe('3.7.2');
  });

  it('shows tooltip with generated label and version', () => {
    const item = new GemStoneLoginItem(
      makeLogin({
        gs_user: 'Admin',
        gem_host: 'db.example.com',
        stone: 'mystone',
        version: '3.7.2',
      }),
    );
    expect(item.tooltip).toBe('Admin on mystone (db.example.com) (3.7.2)');
  });

  it('handles empty fields gracefully', () => {
    const item = new GemStoneLoginItem(
      makeLogin({ gs_user: '', gem_host: '', stone: '', version: '' }),
    );
    expect(item.description).toBe('');
    expect(item.tooltip).toBe(' on  () ()');
  });

  it('sets contextValue for menu filtering', () => {
    const item = new GemStoneLoginItem(makeLogin());
    expect(item.contextValue).toBe('gemstoneLogin');
  });

  it('sets command to edit the login', () => {
    const item = new GemStoneLoginItem(makeLogin());
    expect(item.command).toEqual({
      command: 'gemstone.editLogin',
      title: 'Edit Login',
      arguments: [item],
    });
  });

  it('stores the login data on the item', () => {
    const login = makeLogin({ stone: 'custom' });
    const item = new GemStoneLoginItem(login);
    expect(item.login).toEqual(login);
  });
});
