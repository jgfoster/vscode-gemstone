/**
 * OS-keychain credential storage for Jasper login passwords.
 *
 * Separate from the MCP keychain service (`jasper-gemstone-mcp`) so the two
 * flows have independent lifecycles — deleting a login's keychain entry does
 * not disturb any MCP config, and vice versa.
 */

import { GemStoneLogin } from './loginTypes';

export const KEYCHAIN_SERVICE = 'jasper-gemstone-login';

/** Build a unique account identifier for a login. */
export function loginCredentialAccount(
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): string {
  return `${login.gs_user}@${login.gem_host}/${login.stone}`;
}

/** Store the login's password in the OS keychain. */
export async function setLoginPassword(login: GemStoneLogin): Promise<void> {
  const keytar = await import('keytar');
  await keytar.default.setPassword(
    KEYCHAIN_SERVICE,
    loginCredentialAccount(login),
    login.gs_password,
  );
}

/** Fetch a login's password from the OS keychain. Returns undefined if missing. */
export async function getLoginPassword(
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): Promise<string | undefined> {
  try {
    const keytar = await import('keytar');
    const pw = await keytar.default.getPassword(
      KEYCHAIN_SERVICE,
      loginCredentialAccount(login),
    );
    return pw ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remove a login's password from the OS keychain. Returns true if removed. */
export async function deleteLoginPassword(
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): Promise<boolean> {
  try {
    const keytar = await import('keytar');
    return await keytar.default.deletePassword(
      KEYCHAIN_SERVICE,
      loginCredentialAccount(login),
    );
  } catch {
    return false;
  }
}
