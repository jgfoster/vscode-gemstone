import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../browserQueries', () => ({
  sendersOf: vi.fn(() => []),
  implementorsOf: vi.fn(() => []),
}));

import { Uri } from 'vscode';
import { GemStoneCodeLensProvider } from '../gemstoneCodeLensProvider';
import { SessionManager, ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';

function createMockSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
    },
    stoneVersion: '3.7.2',
  };
}

function createMockDocument(text: string, scheme = 'file') {
  return {
    uri: scheme === 'gemstone'
      ? Uri.parse('gemstone://1/UserGlobals/MyClass/instance/accessing/name')
      : Uri.file('/test.gs'),
    getText: () => text,
    languageId: scheme === 'gemstone' ? 'gemstone-smalltalk' : 'gemstone-topaz',
    lineAt: vi.fn(),
    lineCount: text.split('\n').length,
  };
}

describe('GemStoneCodeLensProvider', () => {
  let sessionManager: SessionManager;
  let provider: GemStoneCodeLensProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new SessionManager();
    provider = new GemStoneCodeLensProvider(sessionManager);
  });

  describe('provideCodeLenses', () => {
    it('returns lenses for method regions in topaz files', () => {
      const doc = createMockDocument(`category: 'accessing'
method: MyClass
name
  ^ name
%
category: 'accessing'
method: MyClass
name: aString
  name := aString
%`);
      const lenses = provider.provideCodeLenses(doc as any);
      expect(lenses).toHaveLength(2);
    });

    it('returns a lens for gemstone:// method URIs', () => {
      const doc = createMockDocument('name\n  ^ name', 'gemstone');
      const lenses = provider.provideCodeLenses(doc as any);
      expect(lenses).toHaveLength(1);
    });

    it('returns no lenses for empty files', () => {
      const doc = createMockDocument('');
      const lenses = provider.provideCodeLenses(doc as any);
      expect(lenses).toHaveLength(0);
    });

    it('returns no lenses for doit-only files', () => {
      const doc = createMockDocument(`run
true
%`);
      const lenses = provider.provideCodeLenses(doc as any);
      expect(lenses).toHaveLength(0);
    });
  });

  describe('resolveCodeLens', () => {
    it('returns "No session" when no session is selected', () => {
      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc as any);
      expect(lenses).toHaveLength(1);

      const resolved = provider.resolveCodeLens(lenses[0]);
      expect(resolved.command?.title).toBe('No session');
    });

    it('shows sender and implementor counts', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;

      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
        { dictName: 'D', className: 'D', isMeta: false, selector: 'foo', category: 'c' },
      ]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'MyClass', isMeta: false, selector: 'foo', category: 'c' },
      ]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc as any);
      const resolved = provider.resolveCodeLens(lenses[0]);

      expect(resolved.command?.title).toBe('2 senders | 1 implementor');
      expect(resolved.command?.command).toBe('gemstone.sendersOfSelector');
    });

    it('handles singular counts', () => {
      const session = createMockSession();
      sessionManager.getSelectedSession = () => session;

      (queries.sendersOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
      ]);
      (queries.implementorsOf as ReturnType<typeof vi.fn>).mockReturnValue([
        { dictName: 'D', className: 'C', isMeta: false, selector: 'foo', category: 'c' },
        { dictName: 'D', className: 'D', isMeta: false, selector: 'foo', category: 'c' },
      ]);

      const doc = createMockDocument(`method: MyClass
foo
  ^ 42
%`);
      const lenses = provider.provideCodeLenses(doc as any);
      const resolved = provider.resolveCodeLens(lenses[0]);

      expect(resolved.command?.title).toBe('1 sender | 2 implementors');
    });
  });
});
