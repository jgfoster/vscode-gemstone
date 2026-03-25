import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../gciLog', () => ({
  logQuery: vi.fn(),
  logResult: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../transcriptChannel', () => ({
  appendTranscript: vi.fn(),
}));

import { CodeExecutor } from '../codeExecutor';
import { SessionManager, ActiveSession } from '../sessionManager';
import * as vscode from 'vscode';

const OOP_NIL = 0x14n;

// ── Helpers ──────────────────────────────────────────────────

function makeGci(overrides: Record<string, unknown> = {}) {
  return {
    GciTsResolveSymbol: vi.fn(() => ({ result: 100n, err: { number: 0 } })),
    GciTsNbExecute: vi.fn((): Record<string, unknown> => ({ success: true, err: { number: 0, message: '' } })),
    GciTsNbPoll: vi.fn(() => ({ result: 1, err: { number: 0 } })),
    GciTsNbResult: vi.fn((): Record<string, unknown> => ({ result: 200n, err: { number: 0, message: '', context: OOP_NIL } })),
    GciTsPerformFetchBytes: vi.fn(() => ({ data: '42', err: { number: 0 } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: '', err: { number: 0 } })),
    GciTsClearStack: vi.fn(),
    GciTsObjExists: vi.fn(() => false),
    GciTsFetchClass: vi.fn(() => ({ result: 0n, err: { number: 0 } })),
    ...overrides,
  };
}

function makeSession(gci = makeGci()): ActiveSession {
  return {
    id: 1,
    gci: gci as unknown as ActiveSession['gci'],
    handle: {} as unknown,
    login: { label: 'Test', gs_user: 'DataCurator' },
    stoneVersion: '3.7.2',
  } as ActiveSession;
}

function makeSessionManager(session?: ActiveSession): SessionManager {
  const s = session ?? makeSession();
  return {
    resolveSession: vi.fn(async () => s),
    getSessions: vi.fn(() => [s]),
    getSession: vi.fn(() => s),
  } as unknown as SessionManager;
}

function makeEditor(text: string, selection?: vscode.Selection) {
  const lines = text.split('\n');
  return {
    document: {
      uri: vscode.Uri.file('/workspace/test.st'),
      getText: vi.fn(() => text),
      lineAt: vi.fn((line: number) => ({
        range: {
          start: new vscode.Position(line, 0),
          end: new vscode.Position(line, (lines[line] || '').length),
        },
        text: lines[line] || '',
      })),
      lineCount: lines.length,
      offsetAt: vi.fn((pos: vscode.Position) => {
        let offset = 0;
        for (let i = 0; i < pos.line && i < lines.length; i++) {
          offset += lines[i].length + 1;
        }
        return offset + pos.character;
      }),
      positionAt: vi.fn((offset: number) => {
        let remaining = offset;
        for (let i = 0; i < lines.length; i++) {
          if (remaining <= lines[i].length) {
            return new vscode.Position(i, remaining);
          }
          remaining -= lines[i].length + 1;
        }
        return new vscode.Position(lines.length - 1, (lines[lines.length - 1] || '').length);
      }),
    },
    selection: selection ?? new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, text.length)),
    edit: vi.fn(async (cb: (builder: { insert: (...args: unknown[]) => void }) => void) => {
      cb({ insert: vi.fn() });
      return true;
    }),
    setDecorations: vi.fn(),
  };
}

function setActiveEditor(editor: ReturnType<typeof makeEditor>): void {
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = editor;
}

/** Return the most recently created mock DiagnosticCollection. */
function lastDiagCollection() {
  const results = vi.mocked(vscode.languages.createDiagnosticCollection).mock.results;
  return results[results.length - 1].value;
}

/** Access private wrapWithTranscriptCapture for direct testing. */
function callWrap(exec: CodeExecutor, code: string) {
  return (exec as unknown as Record<string, (c: string) => { wrappedCode: string; codeOffset: number }>)
    .wrapWithTranscriptCapture(code);
}

// ── Tests ────────────────────────────────────────────────────

describe('CodeExecutor', () => {
  let executor: CodeExecutor;
  let session: ActiveSession;
  let gci: ReturnType<typeof makeGci>;

  beforeEach(() => {
    vi.clearAllMocks();
    gci = makeGci();
    session = makeSession(gci);
    executor = new CodeExecutor(makeSessionManager(session));
  });

  // ── wrapWithTranscriptCapture ──────────────────────────────

  describe('wrapWithTranscriptCapture', () => {
    it('does not escape single quotes in user code', () => {
      const { wrappedCode } = callWrap(executor, "UserGlobals at: #'James' put: 'Foster'.");
      expect(wrappedCode).toContain("UserGlobals at: #'James' put: 'Foster'.");
      expect(wrappedCode).not.toContain("''James''");
      expect(wrappedCode).not.toContain("''Foster''");
    });

    it('preserves string literals with single quotes', () => {
      const { wrappedCode } = callWrap(executor, "'hello world'");
      expect(wrappedCode).toContain("'hello world'");
    });

    it('preserves symbols with single quotes', () => {
      const { wrappedCode } = callWrap(executor, "#'a symbol'");
      expect(wrappedCode).toContain("#'a symbol'");
    });

    it('preserves escaped single quotes inside Smalltalk strings', () => {
      const { wrappedCode } = callWrap(executor, "'it''s a test'");
      expect(wrappedCode).toContain("'it''s a test'");
    });

    it('returns the correct codeOffset', () => {
      const code = '3 + 4';
      const { wrappedCode, codeOffset } = callWrap(executor, code);
      expect(wrappedCode.substring(codeOffset, codeOffset + code.length)).toBe(code);
    });

    it('wraps code in a Transcript capture block', () => {
      const { wrappedCode } = callWrap(executor, '3 + 4');
      expect(wrappedCode).toContain('WriteStream on: String new');
      expect(wrappedCode).toContain('#Transcript');
      expect(wrappedCode).toContain('ensure:');
      expect(wrappedCode).toContain('[__vscResult := [3 + 4] value]');
    });

    it('handles multi-line code', () => {
      const code = "| x |\nx := 42.\nx printString";
      const { wrappedCode, codeOffset } = callWrap(executor, code);
      expect(wrappedCode.substring(codeOffset, codeOffset + code.length)).toBe(code);
    });
  });

  // ── Syntax error diagnostics ───────────────────────────────

  describe('syntax error diagnostics', () => {
    it('shows a diagnostic when GciTsNbExecute fails with a compile error', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: 'a CompileError occurred (error 1001), expected expression, near source character 250',
        },
      });

      const editor = makeEditor('!!! bad syntax');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      expect(dc.set).toHaveBeenCalled();
      const [uri, diags] = dc.set.mock.calls[0];
      expect(uri.toString()).toBe(editor.document.uri.toString());
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('CompileError');
      expect(diags[0].source).toBe('GemStone');
    });

    it('extracts character offset from error and maps to user code position', async () => {
      const prefixLen = callWrap(executor, 'x').codeOffset;
      // Error at the 5th character of user code (1-based in GemStone = prefixLen + 5)
      const gsCharOffset = prefixLen + 5;
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: `a CompileError occurred (error 1001), near source character ${gsCharOffset}`,
        },
      });

      const editor = makeEditor('abcdefghij');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      const [, diags] = dc.set.mock.calls[0];
      // Character 5 (0-based: 4) in user code → column 4 on line 0
      expect(diags[0].range.start.line).toBe(0);
      expect(diags[0].range.start.character).toBe(4);
    });

    it('highlights entire selection when no offset found in error message', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: 'some generic error with no position info',
        },
      });

      const code = 'bad code here';
      const sel = new vscode.Selection(new vscode.Position(2, 5), new vscode.Position(2, 18));
      const editor = makeEditor('line0\nline1\n     bad code here\nline3', sel);
      editor.document.getText = vi.fn(() => code);
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      const [, diags] = dc.set.mock.calls[0];
      expect(diags[0].range.start.line).toBe(2);
      expect(diags[0].range.start.character).toBe(5);
      expect(diags[0].range.end.line).toBe(2);
      expect(diags[0].range.end.character).toBe(18);
    });

    it('clears diagnostics on successful execution', async () => {
      const editor = makeEditor('3 + 4');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      expect(dc.delete).toHaveBeenCalledWith(editor.document.uri);
    });

    it('shows diagnostic for runtime errors (non-debuggable)', async () => {
      (gci.GciTsNbResult as Mock).mockReturnValue({
        result: 0x01n,
        err: {
          number: 2003,
          message: 'a UndefinedObject does not understand #foo',
          context: OOP_NIL,
        },
      });

      const editor = makeEditor('nil foo');
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      expect(dc.set).toHaveBeenCalled();
      const [, diags] = dc.set.mock.calls[0];
      expect(diags[0].message).toContain('does not understand');
    });

    it('maps multi-line code offset to correct editor line', async () => {
      const prefixLen = callWrap(executor, 'x').codeOffset;

      const code = "| x |\nx := 42.\nx foo";
      // 'foo' starts at offset 18 in user code: "| x |\n" (6) + "x := 42.\n" (9) + "x " (2) + "f" = 17; 1-based = 18
      const gsCharOffset = prefixLen + 18;
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: {
          number: 1001,
          message: `near source character ${gsCharOffset}`,
        },
      });

      // Selection starts at line 3
      const sel = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(5, 5));
      const editor = makeEditor("line0\nline1\nline2\n| x |\nx := 42.\nx foo", sel);
      editor.document.getText = vi.fn(() => code);
      setActiveEditor(editor);

      await executor.executeIt();

      const dc = lastDiagCollection();
      const [, diags] = dc.set.mock.calls[0];
      // 'foo' is at offset 17 (0-based) in user code, which is line 2 col 2
      // Editor line = selection start (3) + 2 = 5
      expect(diags[0].range.start.line).toBe(5);
      expect(diags[0].range.start.character).toBe(2);
    });

    it('registers cleanup listener that clears diagnostics on document edit', async () => {
      (gci.GciTsNbExecute as Mock).mockReturnValue({
        success: false,
        err: { number: 1001, message: 'compile error' },
      });

      const editor = makeEditor('bad');
      setActiveEditor(editor);

      await executor.executeIt();

      expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled();
    });
  });

  // ── Execute It / Display It basic flow ─────────────────────

  describe('executeIt', () => {
    it('sends user code with single quotes unescaped to GemStone', async () => {
      const code = "UserGlobals at: #'James' put: 'Foster'.";
      const editor = makeEditor(code);
      setActiveEditor(editor);

      await executor.executeIt();

      const wrappedCode = (gci.GciTsNbExecute as Mock).mock.calls[0][1] as string;
      expect(wrappedCode).toContain("UserGlobals at: #'James' put: 'Foster'.");
      expect(wrappedCode).not.toContain("''James''");
      expect(wrappedCode).not.toContain("''Foster''");
    });
  });

  describe('displayIt', () => {
    it('sends user code with single quotes unescaped to GemStone', async () => {
      const code = "'hello' reversed";
      const editor = makeEditor(code);
      setActiveEditor(editor);

      await executor.displayIt();

      const wrappedCode = (gci.GciTsNbExecute as Mock).mock.calls[0][1] as string;
      expect(wrappedCode).toContain("'hello' reversed");
    });
  });
});
