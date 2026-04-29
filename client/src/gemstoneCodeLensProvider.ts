import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { parseTopazDocument } from './topazFileIn';
import { extractSelector } from './systemBrowser';
import * as queries from './browserQueries';

interface CodeLensData {
  selector: string;
  className?: string;
  isMeta: boolean;
  // Each method contributes two lenses on the same line: one for senders,
  // one for implementors. Keeping them as separate CodeLens objects (rather
  // than one lens with a combined "N senders | M implementors" title that
  // dispatches to senders only) gives the user two clickable links — one
  // per concept — and lets each link compute only its own count.
  kind: 'senders' | 'implementors';
}

export class GemStoneCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private codeLensData = new Map<vscode.CodeLens, CodeLensData>();

  constructor(private sessionManager: SessionManager) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    this.codeLensData.clear();

    if (document.uri.scheme === 'gemstone') {
      return this.provideGemstoneCodeLenses(document);
    }

    // Topaz file — parse regions
    const text = document.getText();
    const regions = parseTopazDocument(text);

    for (const region of regions) {
      if (region.kind !== 'smalltalk-method') continue;

      const firstLine = region.text.split('\n')[0];
      const selector = extractSelector(firstLine);
      if (!selector) continue;

      const range = new vscode.Range(
        new vscode.Position(region.startLine, 0),
        new vscode.Position(region.startLine, 0),
      );
      const isMeta = region.command === 'classmethod';
      lenses.push(...this.makeMethodLenses(range, selector, region.className, isMeta));
    }

    return lenses;
  }

  private provideGemstoneCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    try {
      const uri = document.uri;
      const parts = uri.path.split('/').map(decodeURIComponent);
      // Method: /dict/class/side/category/selector (6 parts, first is empty)
      if (parts.length === 6) {
        const selector = parts[5];
        const className = parts[2];
        const isMeta = parts[3] === 'class';

        const range = new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(0, 0),
        );
        lenses.push(...this.makeMethodLenses(range, selector, className, isMeta));
      }
    } catch {
      // URI parse error — skip
    }

    return lenses;
  }

  // Emit the senders + implementors pair on the same range, in that order.
  // VS Code preserves insertion order on a given range, so the user always
  // sees senders to the left of implementors.
  private makeMethodLenses(
    range: vscode.Range,
    selector: string,
    className: string | undefined,
    isMeta: boolean,
  ): vscode.CodeLens[] {
    const out: vscode.CodeLens[] = [];
    for (const kind of ['senders', 'implementors'] as const) {
      const lens = new vscode.CodeLens(range);
      this.codeLensData.set(lens, { selector, className, isMeta, kind });
      out.push(lens);
    }
    return out;
  }

  resolveCodeLens(codeLens: vscode.CodeLens): vscode.CodeLens {
    const data = this.codeLensData.get(codeLens);
    if (!data) return codeLens;

    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      codeLens.command = {
        title: 'No session',
        command: '',
      };
      return codeLens;
    }

    try {
      const maxEnv = vscode.workspace.getConfiguration('gemstone')
        .get<number>('maxEnvironment', 0);

      // Each lens computes only its own count. Half the GCI work per lens
      // compared to the old combined link, so total work for the pair is
      // unchanged from the user's perspective.
      let count = 0;
      for (let env = 0; env <= maxEnv; env++) {
        try {
          count += data.kind === 'senders'
            ? queries.sendersOf(session, data.selector, env).length
            : queries.implementorsOf(session, data.selector, env).length;
        } catch {
          // Session may be busy or selector not found in this env
        }
      }

      const noun = data.kind === 'senders' ? 'sender' : 'implementor';
      const title = count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
      const command = data.kind === 'senders'
        ? 'gemstone.sendersOfSelector'
        : 'gemstone.implementorsOfSelector';

      codeLens.command = {
        title,
        command,
        arguments: [{ selector: data.selector, sessionId: session.id }],
      };
    } catch {
      codeLens.command = {
        title: '...',
        command: '',
      };
    }

    return codeLens;
  }
}
