export interface GemStoneLogin {
  label: string;
  version: string;
  gem_host: string;
  stone: string;
  gs_user: string;
  gs_password: string;
  netldi: string;
  host_user: string;
  host_password: string;
  /**
   * When true, the GemStone password is stored in the OS keychain and
   * `gs_password` in the settings file is left empty. See loginCredentials.ts.
   */
  password_in_keychain?: boolean;
}

export function loginLabel(login: Pick<GemStoneLogin, 'gs_user' | 'stone' | 'gem_host'>): string {
  return `${login.gs_user} on ${login.stone} (${login.gem_host})`;
}

export const DEFAULT_LOGIN: GemStoneLogin = {
  label: '',
  version: '',
  gem_host: 'localhost',
  stone: 'gs64stone',
  gs_user: 'DataCurator',
  gs_password: 'swordfish',
  netldi: 'gs64ldi',
  host_user: '',
  host_password: '',
};
