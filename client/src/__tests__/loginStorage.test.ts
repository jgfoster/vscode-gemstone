import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { GemStoneLogin, DEFAULT_LOGIN } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
}

describe('LoginStorage', () => {
  let storage: LoginStorage;

  beforeEach(() => {
    __resetConfig();
    storage = new LoginStorage();
  });

  describe('getLogins', () => {
    it('returns empty array when no logins configured', () => {
      expect(storage.getLogins()).toEqual([]);
    });

    it('returns configured logins', () => {
      const logins = [makeLogin({ label: 'A' }), makeLogin({ label: 'B' })];
      __setConfig('gemstone', 'logins', logins);
      expect(storage.getLogins()).toEqual(logins);
    });
  });

  describe('saveLogin', () => {
    it('adds a new login to empty list', async () => {
      const login = makeLogin({ label: 'New' });
      await storage.saveLogin(login);
      expect(storage.getLogins()).toEqual([login]);
    });

    it('adds a new login to existing list', async () => {
      const existing = makeLogin({ label: 'Existing' });
      __setConfig('gemstone', 'logins', [existing]);

      const newLogin = makeLogin({ label: 'New' });
      await storage.saveLogin(newLogin);

      expect(storage.getLogins()).toEqual([existing, newLogin]);
    });

    it('updates an existing login by matching label', async () => {
      const login = makeLogin({ label: 'Server', gem_host: 'old-host' });
      __setConfig('gemstone', 'logins', [login]);

      const updated = makeLogin({ label: 'Server', gem_host: 'new-host' });
      await storage.saveLogin(updated);

      const result = storage.getLogins();
      expect(result).toHaveLength(1);
      expect(result[0].gem_host).toBe('new-host');
    });

    it('supports renaming via originalLabel', async () => {
      const login = makeLogin({ label: 'Old Name' });
      __setConfig('gemstone', 'logins', [login]);

      const renamed = makeLogin({ label: 'New Name' });
      await storage.saveLogin(renamed, 'Old Name');

      const result = storage.getLogins();
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('New Name');
    });

    it('adds as new if originalLabel not found', async () => {
      const existing = makeLogin({ label: 'A' });
      __setConfig('gemstone', 'logins', [existing]);

      const newLogin = makeLogin({ label: 'B' });
      await storage.saveLogin(newLogin, 'Nonexistent');

      expect(storage.getLogins()).toHaveLength(2);
    });
  });

  describe('deleteLogin', () => {
    it('removes a login by label', async () => {
      __setConfig('gemstone', 'logins', [
        makeLogin({ label: 'A' }),
        makeLogin({ label: 'B' }),
        makeLogin({ label: 'C' }),
      ]);

      await storage.deleteLogin('B');

      const result = storage.getLogins();
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.label)).toEqual(['A', 'C']);
    });

    it('does nothing when label not found', async () => {
      __setConfig('gemstone', 'logins', [makeLogin({ label: 'A' })]);
      await storage.deleteLogin('Nonexistent');
      expect(storage.getLogins()).toHaveLength(1);
    });

    it('handles deleting from empty list', async () => {
      await storage.deleteLogin('Anything');
      expect(storage.getLogins()).toEqual([]);
    });
  });
});
