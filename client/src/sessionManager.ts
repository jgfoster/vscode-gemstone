import * as vscode from 'vscode';
import { GciLibrary, GciError } from './gciLibrary';
import { GemStoneLogin } from './loginTypes';
import { logInfo } from './gciLog';

export interface ActiveSession {
  id: number;
  gci: GciLibrary;
  handle: unknown;
  login: GemStoneLogin;
  stoneVersion: string;
}

export class SessionManager {
  private sessions = new Map<number, ActiveSession>();
  private gciInstances = new Map<string, GciLibrary>();
  private nextId = 1;

  private _selectedId: number | null = null;
  private _onDidChangeSelection = new vscode.EventEmitter<number | null>();
  readonly onDidChangeSelection = this._onDidChangeSelection.event;

  get selectedId(): number | null {
    return this._selectedId;
  }

  selectSession(id: number): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    this._selectedId = id;
    this._onDidChangeSelection.fire(id);
    vscode.commands.executeCommand('setContext', 'gemstone.hasActiveSession', true);
  }

  getSession(id: number): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  getSelectedSession(): ActiveSession | undefined {
    if (this._selectedId !== null) {
      return this.sessions.get(this._selectedId);
    }
    return undefined;
  }

  async resolveSession(): Promise<ActiveSession | undefined> {
    const selected = this.getSelectedSession();
    if (selected) return selected;

    const sessions = this.getSessions();
    if (sessions.length === 0) {
      vscode.window.showErrorMessage('No GemStone sessions are active. Please log in first.');
      return undefined;
    }
    if (sessions.length === 1) {
      this.selectSession(sessions[0].id);
      return sessions[0];
    }

    const items = sessions.map(s => ({
      label: s.login.label,
      description: `${s.id}: ${s.login.gs_user} in ${s.login.stone} on ${s.login.gem_host}`,
      session: s,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a GemStone session for code execution',
    });
    if (!pick) return undefined;
    this.selectSession(pick.session.id);
    return pick.session;
  }

  private getGciLibrary(libraryPath: string): GciLibrary {
    let gci = this.gciInstances.get(libraryPath);
    if (!gci) {
      gci = new GciLibrary(libraryPath);
      this.gciInstances.set(libraryPath, gci);
    }
    return gci;
  }

  login(login: GemStoneLogin, libraryPath: string): ActiveSession {
    const gci = this.getGciLibrary(libraryPath);

    const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
    const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;

    const result = gci.GciTsLogin(
      stoneNrs,
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrs,
      login.gs_user,
      login.gs_password,
      0, 0,
    );

    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }

    const { version } = gci.GciTsVersion();

    const session: ActiveSession = {
      id: this.nextId++,
      gci,
      handle: result.session,
      login,
      stoneVersion: version,
    };

    this.sessions.set(session.id, session);
    logInfo(`[Session ${session.id}] Logged in: ${login.gs_user}@${login.gem_host}/${login.stone} (${version})`);

    // Auto-select when this is the only session
    if (this.sessions.size === 1) {
      this.selectSession(session.id);
    }

    return session;
  }

  logout(id: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    logInfo(`[Session ${id}] Logging out: ${s.login.gs_user}@${s.login.gem_host}/${s.login.stone}`);
    try {
      s.gci.GciTsLogout(s.handle);
    } catch {
      // Session may already be dead — remove it regardless
    }
    this.sessions.delete(id);

    if (this._selectedId === id) {
      this._selectedId = null;
      if (this.sessions.size === 1) {
        const remaining = this.sessions.values().next().value!;
        this.selectSession(remaining.id);
      } else {
        this._onDidChangeSelection.fire(null);
        vscode.commands.executeCommand('setContext', 'gemstone.hasActiveSession', this.sessions.size > 0);
      }
    }
  }

  commit(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    return s.gci.GciTsCommit(s.handle);
  }

  abort(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    return s.gci.GciTsAbort(s.handle);
  }

  getSessions(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      try { s.gci.GciTsLogout(s.handle); } catch { /* ignore */ }
    }
    this.sessions.clear();
    for (const gci of this.gciInstances.values()) {
      try { gci.close(); } catch { /* ignore */ }
    }
    this.gciInstances.clear();
    this._onDidChangeSelection.dispose();
  }
}
