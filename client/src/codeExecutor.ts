import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { OOP_ILLEGAL, OOP_NIL, GCI_PERFORM_FLAG_ENABLE_DEBUG } from './gciConstants';
import { logQuery, logResult, logError, logInfo } from './gciLog';
import { InspectorTreeProvider } from './inspectorTreeProvider';
import { appendTranscript } from './transcriptChannel';

const BACKOFF_INTERVALS = [10, 10, 20, 40, 80, 160, 320, 500];
const MAX_INTERVAL = 500;
const PROGRESS_THRESHOLD_MS = 2000;
const MAX_RESULT_SIZE = 64 * 1024;

// Decoration type for Display It results.
// Uses color + italic so it's visible even while text is selected
// (selection background covers decoration background, but not text color).
const resultDecorationType = vscode.window.createTextEditorDecorationType({
  fontStyle: 'italic',
  dark: {
    color: '#7cc6ff',
    backgroundColor: 'rgba(51, 153, 255, 0.2)',
  },
  light: {
    color: '#005fa3',
    backgroundColor: 'rgba(0, 102, 204, 0.1)',
  },
});

class ExecutionCancelledError extends Error {
  constructor() {
    super('Execution cancelled');
  }
}

class DebuggableError extends Error {
  constructor(message: string, public readonly context: bigint) {
    super(message);
  }
}

// koffi returns uint64 as Number when the value fits in MAX_SAFE_INTEGER.
// Normalize to bigint for correct comparison with OOP_NIL etc.
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export class CodeExecutor {
  private executing = new Set<number>();
  private oopClassStringCache = new Map<unknown, bigint>();
  private diagnostics: vscode.DiagnosticCollection;

  constructor(private sessionManager: SessionManager) {
    this.diagnostics = vscode.languages.createDiagnosticCollection('gemstone-execute');
  }

  dispose(): void {
    this.diagnostics.dispose();
  }

  async displayIt(): Promise<void> {
    return this.execute(true);
  }

  async executeIt(): Promise<void> {
    return this.execute(false);
  }

  private async execute(displayResult: boolean): Promise<void> {
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.'
      );
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active text editor.');
      return;
    }

    let selection = editor.selection;
    if (selection.isEmpty) {
      const line = editor.document.lineAt(selection.active.line);
      selection = new vscode.Selection(line.range.start, line.range.end);
    }

    const code = editor.document.getText(selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage('No code to execute.');
      return;
    }

    const oopClassString = this.resolveOopClassString(session);
    if (oopClassString === undefined) return;

    this.executing.add(session.id);
    const label = displayResult ? 'Display It' : 'Execute It';
    logQuery(session.id, label, code);
    const { wrappedCode, codeOffset } = this.wrapWithTranscriptCapture(code);
    try {
      const { success, err: startErr } = session.gci.GciTsNbExecute(
        session.handle, wrappedCode, oopClassString,
        OOP_ILLEGAL, OOP_NIL, GCI_PERFORM_FLAG_ENABLE_DEBUG, 0,
      );
      if (!success) {
        const msg = startErr.message || `error ${startErr.number}`;
        logError(session.id, msg);
        this.showCompileError(editor, selection, code, codeOffset, msg);
        return;
      }

      const resultString = await this.pollForResult(session);

      const transcript = this.fetchTranscriptOutput(session);
      if (transcript) appendTranscript(transcript);

      logResult(session.id, resultString);
      this.diagnostics.delete(editor.document.uri);

      if (displayResult) {
        await editor.edit(editBuilder => {
          editBuilder.insert(selection.end, ` ${resultString}`);
        });

        // Place cursor after the inserted result
        const resultStart = selection.end.translate(0, 1);
        const resultEnd = editor.document.positionAt(
          editor.document.offsetAt(selection.end) + 1 + resultString.length
        );
        editor.selection = new vscode.Selection(resultEnd, resultEnd);

        // Apply decoration so the result is visually distinct (Cmd+Z to undo)
        const decoRange = new vscode.Range(resultStart, resultEnd);
        editor.setDecorations(resultDecorationType, [decoRange]);

        // Clear decoration when document is next edited
        setTimeout(() => {
          const disposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === editor.document) {
              editor.setDecorations(resultDecorationType, []);
              disposable.dispose();
            }
          });
        }, 0);
      } else {
        vscode.window.setStatusBarMessage('GemStone: Executed successfully.', 3000);
      }
    } catch (e: unknown) {
      if (e instanceof ExecutionCancelledError) return;
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);

      if (e instanceof DebuggableError) {
        // Try to show as inline diagnostic first; fall back to debug dialog
        this.showCompileError(editor, selection, code, codeOffset, msg);
        const choice = await vscode.window.showErrorMessage(
          `GemStone error: ${msg}`, 'Debug', 'Dismiss',
        );
        if (choice === 'Debug') {
          vscode.debug.startDebugging(undefined, {
            type: 'gemstone',
            name: 'GemStone Error',
            request: 'attach',
            sessionId: session.id,
            gsProcess: e.context.toString(),
            errorMessage: msg,
          }, { suppressSaveBeforeStart: true });
        } else {
          try { session.gci.GciTsClearStack(session.handle, e.context); } catch { /* ignore */ }
        }
      } else {
        this.showCompileError(editor, selection, code, codeOffset, msg);
      }
    } finally {
      this.executing.delete(session.id);
    }
  }

  private validateContextOop(session: ActiveSession, context: bigint): void {
    const hex = '0x' + context.toString(16);
    logInfo(`[Session ${session.id}] Debug context OOP: ${context} (${hex})`);

    // Check if the object exists
    const exists = session.gci.GciTsObjExists(session.handle, context);
    logInfo(`[Session ${session.id}] Debug context ObjExists: ${exists}`);

    if (exists) {
      // Try to get its class
      const { result: classOop, err } = session.gci.GciTsFetchClass(
        session.handle, context,
      );
      if (err.number === 0) {
        // Get class name
        const { data, err: nameErr } = session.gci.GciTsPerformFetchBytes(
          session.handle, classOop, 'name', [], 256,
        );
        logInfo(`[Session ${session.id}] Debug context class: ${nameErr.number === 0 ? data : `error ${nameErr.number}`}`);
      } else {
        logInfo(`[Session ${session.id}] Debug context FetchClass error: ${err.message}`);
      }
    }
  }

  private wrapWithTranscriptCapture(code: string): { wrappedCode: string; codeOffset: number } {
    // Wrap user code so that Transcript writes are captured into SessionTemps.
    // The wrapped code:
    //   1. Creates a capture WriteStream
    //   2. Saves the original Transcript
    //   3. Installs the capture stream as Transcript in SessionTemps
    //   4. Evaluates the user code inside an ensure: block
    //   5. Restores the original Transcript and stores captured text
    //
    // The user code is embedded directly in Smalltalk source (inside a block),
    // NOT inside a string literal, so single quotes must NOT be escaped.
    const prefix = `| __vscCapture __vscOriginal __vscResult |
__vscCapture := WriteStream on: String new.
__vscOriginal := SessionTemps current at: #Transcript ifAbsent: [nil].
SessionTemps current at: #Transcript put: __vscCapture.
[__vscResult := [`;
    const suffix = `] value]
  ensure: [
    SessionTemps current at: #Transcript put: __vscOriginal.
    SessionTemps current at: #'__vscTranscriptResult' put: __vscCapture contents.
  ].
__vscResult`;
    return {
      wrappedCode: prefix + code + suffix,
      codeOffset: prefix.length,
    };
  }

  private fetchTranscriptOutput(session: ActiveSession): string {
    try {
      const code = `| __t |
__t := SessionTemps current at: #'__vscTranscriptResult' ifAbsent: [''].
SessionTemps current removeKey: #'__vscTranscriptResult' ifAbsent: [].
__t`;
      const { data, err } = session.gci.GciTsExecuteFetchBytes(
        session.handle, code, -1, OOP_NIL, OOP_ILLEGAL, OOP_NIL, MAX_RESULT_SIZE,
      );
      if (err.number !== 0) return '';
      return data || '';
    } catch {
      return '';
    }
  }

  private resolveOopClassString(session: ActiveSession): bigint | undefined {
    let oop = this.oopClassStringCache.get(session.handle);
    if (oop !== undefined) return oop;

    const { result, err } = session.gci.GciTsResolveSymbol(
      session.handle, 'String', OOP_NIL,
    );
    if (err.number !== 0) {
      vscode.window.showErrorMessage(
        `Failed to resolve String class: ${err.message || `error ${err.number}`}`
      );
      return undefined;
    }
    oop = result;
    this.oopClassStringCache.set(session.handle, oop);
    return oop;
  }

  /**
   * Show a compile/syntax error as an inline diagnostic in the editor.
   *
   * GemStone error messages for compile errors typically contain a 1-based
   * character offset into the source string (e.g. "...near source character 45").
   * Since the user code is wrapped in a Transcript-capture template, we subtract
   * the wrapper prefix length to map back to the user's original code, then
   * convert to a line/column position relative to the editor selection.
   */
  private showCompileError(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    userCode: string,
    wrapperPrefixLength: number,
    message: string,
  ): void {
    // Try to extract a character offset from the error message.
    // GemStone formats vary; common patterns include:
    //   "...near source character 45"
    //   "...at or near character 45"
    //   "...Error, (offset 45)"
    const offsetMatch = message.match(
      /(?:character|offset|position)\s+(\d+)/i,
    );
    let diagRange: vscode.Range;
    if (offsetMatch) {
      const gsOffset = parseInt(offsetMatch[1], 10) - 1; // GemStone is 1-based
      const userOffset = Math.max(0, Math.min(gsOffset - wrapperPrefixLength, userCode.length));
      diagRange = this.offsetToEditorRange(editor, selection, userCode, userOffset);
    } else {
      // No offset found — highlight the entire selection
      diagRange = new vscode.Range(selection.start, selection.end);
    }

    const diag = new vscode.Diagnostic(diagRange, message, vscode.DiagnosticSeverity.Error);
    diag.source = 'GemStone';
    this.diagnostics.set(editor.document.uri, [diag]);

    // Clear diagnostic when the document is next edited
    const disposable = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === editor.document) {
        this.diagnostics.delete(editor.document.uri);
        disposable.dispose();
      }
    });
  }

  /**
   * Convert a character offset within the user code to an editor Range.
   * The range highlights the line containing the error.
   */
  private offsetToEditorRange(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    userCode: string,
    userOffset: number,
  ): vscode.Range {
    const beforeError = userCode.substring(0, userOffset);
    const lines = beforeError.split('\n');
    const errorLineInCode = lines.length - 1; // 0-based line within user code
    const errorCol = lines[lines.length - 1].length;

    // Map to editor position relative to the selection start
    const editorLine = selection.start.line + errorLineInCode;
    const editorCol = errorLineInCode === 0
      ? selection.start.character + errorCol
      : errorCol;

    const pos = new vscode.Position(editorLine, editorCol);
    // Highlight from the error position to the end of that line
    const lineEnd = editor.document.lineAt(editorLine).range.end;
    return new vscode.Range(pos, lineEnd);
  }

  private pollForCompletion<T>(
    session: ActiveSession, onReady: () => T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let pollIndex = 0;
      let elapsedMs = 0;
      let progressShown = false;
      let softBreakSent = false;
      let progressResolve: (() => void) | null = null;

      const finishProgress = () => {
        if (progressResolve) {
          progressResolve();
          progressResolve = null;
        }
      };

      const doPoll = () => {
        const { result: pollResult, err: pollErr } = session.gci.GciTsNbPoll(
          session.handle, 0,
        );

        if (pollResult === 1) {
          finishProgress();
          try {
            resolve(onReady());
          } catch (e) {
            reject(e);
          }
          return;
        }

        if (pollResult === -1) {
          finishProgress();
          const msg = pollErr.message || `GemStone poll error ${pollErr.number}`;
          reject(new Error(msg));
          return;
        }

        const interval = pollIndex < BACKOFF_INTERVALS.length
          ? BACKOFF_INTERVALS[pollIndex]
          : MAX_INTERVAL;
        pollIndex++;
        elapsedMs += interval;

        if (elapsedMs >= PROGRESS_THRESHOLD_MS && !progressShown) {
          progressShown = true;
          vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: softBreakSent
                ? 'GemStone: Soft break sent. Waiting...'
                : 'GemStone: Executing...',
              cancellable: true,
            },
            (_progress, token) => {
              token.onCancellationRequested(() => {
                if (!softBreakSent) {
                  session.gci.GciTsBreak(session.handle, false);
                  softBreakSent = true;
                } else {
                  session.gci.GciTsBreak(session.handle, true);
                  finishProgress();
                  reject(new ExecutionCancelledError());
                }
              });
              return new Promise<void>(res => {
                progressResolve = res;
              });
            },
          );
        }

        setTimeout(doPoll, interval);
      };

      doPoll();
    });
  }

  private pollForResult(session: ActiveSession): Promise<string> {
    return this.pollForCompletion(session, () => this.fetchResultString(session));
  }

  private pollForResultOop(session: ActiveSession): Promise<bigint> {
    return this.pollForCompletion(session, () => this.fetchResultOop(session));
  }

  private fetchResultOop(session: ActiveSession): bigint {
    const { result: resultOop, err: resultErr } = session.gci.GciTsNbResult(
      session.handle,
    );
    if (resultErr.number !== 0) {
      const msg = resultErr.message || `GemStone error ${resultErr.number}`;
      const context = toBigInt(resultErr.context as unknown as number | bigint);
      if (context !== OOP_NIL && context !== 0n) {
        this.validateContextOop(session, context);
        throw new DebuggableError(msg, context);
      }
      throw new Error(msg);
    }
    return resultOop;
  }

  private fetchResultString(session: ActiveSession): string {
    const resultOop = this.fetchResultOop(session);

    const { data, err: fetchErr } = session.gci.GciTsPerformFetchBytes(
      session.handle, resultOop, 'printString', [], MAX_RESULT_SIZE,
    );
    if (fetchErr.number !== 0) {
      throw new Error(fetchErr.message || `printString error ${fetchErr.number}`);
    }

    return data;
  }

  // ── Inspect ──────────────────────────────────────────

  async inspectIt(inspectorProvider: InspectorTreeProvider): Promise<void> {
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.'
      );
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active text editor.');
      return;
    }

    let selection = editor.selection;
    if (selection.isEmpty) {
      const line = editor.document.lineAt(selection.active.line);
      selection = new vscode.Selection(line.range.start, line.range.end);
    }

    const code = editor.document.getText(selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage('No code to execute.');
      return;
    }

    const label = code.trim().split('\n')[0].slice(0, 40);
    await this.executeAndInspect(session, code, label, inspectorProvider);
  }

  async inspectExpression(
    inspectorProvider: InspectorTreeProvider, code: string, label: string,
  ): Promise<void> {
    const session = await this.sessionManager.resolveSession();
    if (!session) return;

    if (this.executing.has(session.id)) {
      vscode.window.showWarningMessage(
        'A GemStone execution is already in progress on this session.'
      );
      return;
    }

    await this.executeAndInspect(session, code, label, inspectorProvider);
  }

  private async executeAndInspect(
    session: ActiveSession, code: string, label: string,
    inspectorProvider: InspectorTreeProvider,
  ): Promise<void> {
    const oopClassString = this.resolveOopClassString(session);
    if (oopClassString === undefined) return;

    this.executing.add(session.id);
    logQuery(session.id, 'Inspect It', code);
    const { wrappedCode } = this.wrapWithTranscriptCapture(code);
    try {
      const { success, err: startErr } = session.gci.GciTsNbExecute(
        session.handle, wrappedCode, oopClassString,
        OOP_ILLEGAL, OOP_NIL, GCI_PERFORM_FLAG_ENABLE_DEBUG, 0,
      );
      if (!success) {
        const msg = `Execution failed to start: ${startErr.message || `error ${startErr.number}`}`;
        logError(session.id, msg);
        vscode.window.showErrorMessage(msg);
        return;
      }

      const oop = await this.pollForResultOop(session);

      const transcript = this.fetchTranscriptOutput(session);
      if (transcript) appendTranscript(transcript);

      logResult(session.id, `OOP ${oop}`);
      inspectorProvider.addRoot(session.id, oop, label);
    } catch (e: unknown) {
      if (e instanceof ExecutionCancelledError) return;
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, msg);

      if (e instanceof DebuggableError) {
        const choice = await vscode.window.showErrorMessage(
          `GemStone error: ${msg}`, 'Debug', 'Dismiss',
        );
        if (choice === 'Debug') {
          vscode.debug.startDebugging(undefined, {
            type: 'gemstone',
            name: 'GemStone Error',
            request: 'attach',
            sessionId: session.id,
            gsProcess: e.context.toString(),
            errorMessage: msg,
          }, { suppressSaveBeforeStart: true });
        } else {
          try { session.gci.GciTsClearStack(session.handle, e.context); } catch { /* ignore */ }
        }
      } else {
        vscode.window.showErrorMessage(`GemStone execution error: ${msg}`);
      }
    } finally {
      this.executing.delete(session.id);
    }
  }
}
