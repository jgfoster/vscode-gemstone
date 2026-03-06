import { describe, it, expect, beforeEach, vi } from 'vitest';

const configValues: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  EventEmitter: class {
    fire = vi.fn();
    event = vi.fn();
    dispose = vi.fn();
  },
  window: { showQuickPick: vi.fn() },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
    })),
  },
}));

vi.mock('../gciLibrary', () => ({
  GciLibrary: class {
    GciTsLogin() { return { session: {}, err: { number: 0, message: '' } }; }
    GciTsVersion() { return { version: '3.7.2' }; }
    GciTsLogout() {}
    close() {}
  },
}));

vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
}));

import { SessionManager } from '../sessionManager';
import { DEFAULT_LOGIN } from '../loginTypes';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(configValues)) delete configValues[k];
    manager = new SessionManager();
  });

  it('allows a first login', () => {
    const session = manager.login({ ...DEFAULT_LOGIN, label: 'Test' }, '/mock/lib');
    expect(session.id).toBe(1);
  });

  it('allows multiple sessions with default export path (includes {session})', () => {
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    const session2 = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
    expect(session2.id).toBe(2);
  });

  it('allows multiple sessions when custom export path includes {session}', () => {
    configValues['exportPath'] = '{workspaceRoot}/gemstone/{session}/{dictName}';
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    const session2 = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
    expect(session2.id).toBe(2);
  });

  it('rejects a second login when custom export path lacks {session}', () => {
    configValues['exportPath'] = '{workspaceRoot}/gemstone/{dictName}';
    manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    expect(() => manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib'))
      .toThrow('Only one session is allowed at a time');
  });

  it('allows login again after logging out', () => {
    configValues['exportPath'] = '{workspaceRoot}/gemstone/{dictName}';
    const session = manager.login({ ...DEFAULT_LOGIN, label: 'First' }, '/mock/lib');
    manager.logout(session.id);
    const session2 = manager.login({ ...DEFAULT_LOGIN, label: 'Second' }, '/mock/lib');
    expect(session2.id).toBe(2);
  });
});
