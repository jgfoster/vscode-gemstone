import * as vscode from 'vscode';
import { GemStoneLogin } from './loginTypes';

export class LoginStorage {
  getLogins(): GemStoneLogin[] {
    const config = vscode.workspace.getConfiguration('gemstone');
    return config.get<GemStoneLogin[]>('logins', []);
  }

  async saveLogin(login: GemStoneLogin, originalLabel?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const logins = [...this.getLogins()];
    const matchLabel = originalLabel ?? login.label;
    const index = logins.findIndex((l) => l.label === matchLabel);

    if (index >= 0) {
      logins[index] = login;
    } else {
      logins.push(login);
    }

    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
  }

  async deleteLogin(label: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const logins = this.getLogins().filter((l) => l.label !== label);
    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
  }

  getGciLibraryPath(version: string): string | undefined {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = config.get<Record<string, string>>('gciLibraries', {});
    return libraries[version];
  }

  async setGciLibraryPath(version: string, libraryPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = { ...config.get<Record<string, string>>('gciLibraries', {}) };
    libraries[version] = libraryPath;
    await config.update('gciLibraries', libraries, vscode.ConfigurationTarget.Global);
  }
}
