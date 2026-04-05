import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import { workspace, window } from '../__mocks__/vscode';
import { openWorkspace } from '../workspace';

// openWorkspace imports vscode internally, so the mock is already wired up

describe('openWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (workspace.textDocuments as unknown[]).length = 0;
  });

  it('opens a gemstone://sessionId/Workspace document', async () => {
    await openWorkspace(1);
    expect(workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: 'gemstone', authority: '1', path: '/Workspace' }),
    );
  });

  it('shows the document with preview disabled', async () => {
    await openWorkspace(1);
    expect(window.showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false }),
    );
  });

  it('does not open if workspace document is already open', async () => {
    (workspace.textDocuments as unknown[]).push({
      uri: { toString: () => 'gemstone://1/Workspace' },
    });
    await openWorkspace(1);
    expect(workspace.openTextDocument).not.toHaveBeenCalled();
    expect(window.showTextDocument).not.toHaveBeenCalled();
  });

  it('opens a new workspace for a different session', async () => {
    (workspace.textDocuments as unknown[]).push({
      uri: { toString: () => 'gemstone://1/Workspace' },
    });
    await openWorkspace(2);
    expect(workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ authority: '2' }),
    );
  });
});
