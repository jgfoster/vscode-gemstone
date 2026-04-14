import { describe, it, expect, vi, beforeEach } from 'vitest';

const setPassword = vi.fn(() => Promise.resolve());
const getPassword = vi.fn((_s: string, _a: string) => Promise.resolve(null as string | null));
const deletePassword = vi.fn((_s: string, _a: string) => Promise.resolve(true));

vi.mock('keytar', () => ({
  default: { setPassword, getPassword, deletePassword },
}));

import {
  KEYCHAIN_SERVICE,
  loginCredentialAccount,
  setLoginPassword,
  getLoginPassword,
  deleteLoginPassword,
} from '../loginCredentials';
import { GemStoneLogin } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return {
    label: 'Test',
    version: '3.7.4',
    gem_host: 'localhost',
    stone: 'gs64stone',
    gs_user: 'DataCurator',
    gs_password: 'swordfish',
    netldi: 'gs64ldi',
    host_user: '',
    host_password: '',
    ...overrides,
  };
}

describe('loginCredentials', () => {
  beforeEach(() => {
    setPassword.mockClear();
    getPassword.mockClear();
    deletePassword.mockClear();
    getPassword.mockResolvedValue(null);
    deletePassword.mockResolvedValue(true);
  });

  describe('KEYCHAIN_SERVICE', () => {
    it('is distinct from the MCP service', () => {
      expect(KEYCHAIN_SERVICE).toBe('jasper-gemstone-login');
    });
  });

  describe('loginCredentialAccount', () => {
    it('combines user, host, and stone', () => {
      expect(loginCredentialAccount(makeLogin())).toBe('DataCurator@localhost/gs64stone');
    });

    it('differs for different users on the same stone', () => {
      const a = loginCredentialAccount(makeLogin({ gs_user: 'DataCurator' }));
      const b = loginCredentialAccount(makeLogin({ gs_user: 'SystemUser' }));
      expect(a).not.toBe(b);
    });

    it('differs for the same user on different stones', () => {
      const a = loginCredentialAccount(makeLogin({ stone: 'dev' }));
      const b = loginCredentialAccount(makeLogin({ stone: 'prod' }));
      expect(a).not.toBe(b);
    });
  });

  describe('setLoginPassword', () => {
    it('stores under jasper-gemstone-login with the account identifier', async () => {
      await setLoginPassword(makeLogin());

      expect(setPassword).toHaveBeenCalledWith(
        'jasper-gemstone-login',
        'DataCurator@localhost/gs64stone',
        'swordfish',
      );
    });
  });

  describe('getLoginPassword', () => {
    it('returns the stored password from the keychain', async () => {
      getPassword.mockResolvedValue('stored-pw');
      const pw = await getLoginPassword(makeLogin());

      expect(getPassword).toHaveBeenCalledWith(
        'jasper-gemstone-login',
        'DataCurator@localhost/gs64stone',
      );
      expect(pw).toBe('stored-pw');
    });

    it('returns undefined when no password is stored', async () => {
      getPassword.mockResolvedValue(null);
      const pw = await getLoginPassword(makeLogin());
      expect(pw).toBeUndefined();
    });

    it('returns undefined when keytar throws', async () => {
      getPassword.mockRejectedValueOnce(new Error('libsecret unavailable'));
      const pw = await getLoginPassword(makeLogin());
      expect(pw).toBeUndefined();
    });
  });

  describe('deleteLoginPassword', () => {
    it('delegates to keytar.deletePassword and returns its result', async () => {
      const ok = await deleteLoginPassword(makeLogin());

      expect(deletePassword).toHaveBeenCalledWith(
        'jasper-gemstone-login',
        'DataCurator@localhost/gs64stone',
      );
      expect(ok).toBe(true);
    });

    it('returns false when keytar throws', async () => {
      deletePassword.mockRejectedValueOnce(new Error('no entry'));
      const ok = await deleteLoginPassword(makeLogin());
      expect(ok).toBe(false);
    });
  });
});
