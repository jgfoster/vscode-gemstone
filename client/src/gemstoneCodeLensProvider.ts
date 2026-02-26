import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { parseTopazDocument } from './topazFileIn';
import { extractSelector } from './systemBrowser';
import * as queries from './browserQueries';

interface CodeLensData {
  selector: string;
  className?: string;
  isMeta: boolean;
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
      const lens = new vscode.CodeLens(range);
      this.codeLensData.set(lens, {
        selector,
        className: region.className,
        isMeta: region.command === 'classmethod',
      });
      lenses.push(lens);
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
        const lens = new vscode.CodeLens(range);
        this.codeLensData.set(lens, { selector, className, isMeta });
        lenses.push(lens);
      }
    } catch {
      // URI parse error — skip
    }

    return lenses;
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

      let senderCount = 0;
      let implementorCount = 0;

      for (let env = 0; env <= maxEnv; env++) {
        try {
          senderCount += queries.sendersOf(session, data.selector, env).length;
          implementorCount += queries.implementorsOf(session, data.selector, env).length;
        } catch {
          // Session may be busy or selector not found in this env
        }
      }

      const sLabel = senderCount === 1 ? '1 sender' : `${senderCount} senders`;
      const iLabel = implementorCount === 1 ? '1 implementor' : `${implementorCount} implementors`;

      codeLens.command = {
        title: `${sLabel} | ${iLabel}`,
        command: 'gemstone.sendersOfSelector',
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
