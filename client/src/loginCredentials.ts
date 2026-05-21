/**
 * Secret storage for Jasper login passwords, backed by VS Code's
 * SecretStorage API (which delegates to the OS keychain on each platform).
 *
 * Keys are namespaced with `KEYCHAIN_SERVICE` so they don't collide with
 * other secrets the extension might store in the future.
 */

import * as vscode from 'vscode';
import { GemStoneLogin } from './loginTypes';

export const KEYCHAIN_SERVICE = 'jasper-gemstone-login';

/** Build a unique account identifier for a login. */
export function loginCredentialAccount(
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): string {
  return `${login.gs_user}@${login.gem_host}/${login.stone}`;
}

function loginSecretKey(
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): string {
  return `${KEYCHAIN_SERVICE}:${loginCredentialAccount(login)}`;
}

/** Store the login's password in SecretStorage. */
export async function setLoginPassword(
  secrets: vscode.SecretStorage,
  login: GemStoneLogin,
): Promise<void> {
  await secrets.store(loginSecretKey(login), login.gs_password);
}

/** Fetch a login's password from SecretStorage. Returns undefined if missing or unreadable. */
export async function getLoginPassword(
  secrets: vscode.SecretStorage,
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): Promise<string | undefined> {
  try {
    return await secrets.get(loginSecretKey(login));
  } catch {
    return undefined;
  }
}

/** Remove a login's password from SecretStorage. Returns true on success. */
export async function deleteLoginPassword(
  secrets: vscode.SecretStorage,
  login: Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>,
): Promise<boolean> {
  try {
    await secrets.delete(loginSecretKey(login));
    return true;
  } catch {
    return false;
  }
}
