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
}

export const DEFAULT_LOGIN: GemStoneLogin = {
  label: '',
  version: '3.7.2',
  gem_host: 'localhost',
  stone: 'gs64stone',
  gs_user: 'DataCurator',
  gs_password: 'swordfish',
  netldi: 'gs64ldi',
  host_user: '',
  host_password: '',
};
