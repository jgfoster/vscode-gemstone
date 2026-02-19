import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { SelectorResolver } from './gemstoneDefinitionProvider';
import * as queries from './browserQueries';

export class GemStoneHoverProvider implements vscode.HoverProvider {
  constructor(
    private sessionManager: SessionManager,
    private selectorResolver?: SelectorResolver,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return null;

    // 1. Try selector → show implementors with categories
    let selector: string | null = null;
    if (this.selectorResolver) {
      try {
        selector = await this.selectorResolver.getSelector(
          document.uri.toString(),
          position,
        );
      } catch { /* LSP not ready */ }
    }

    if (selector) {
      const env = vscode.workspace
        .getConfiguration('gemstone')
        .get<number>('maxEnvironment', 0);
      const results = queries.implementorsOf(session, selector, env);
      if (results.length === 0) return null;

      const md = new vscode.MarkdownString();
      md.appendMarkdown(
        `**#${selector}** — *${results.length}* implementor${results.length === 1 ? '' : 's'}\n\n`,
      );
      const show = results.slice(0, 10);
      for (const r of show) {
        const side = r.isMeta ? ' class' : '';
        md.appendMarkdown(`- \`${r.className}${side}\` (${r.category})\n`);
      }
      if (results.length > 10) {
        md.appendMarkdown(`\n...and ${results.length - 10} more`);
      }
      return new vscode.Hover(md);
    }

    // 2. Try class name → show comment
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (!word || word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) {
      return null;
    }

    const classEntries = queries.getAllClassNames(session)
      .filter(e => e.className === word);
    if (classEntries.length === 0) return null;

    const entry = classEntries[0];
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${word}** *${entry.dictName}*\n\n`);
    try {
      const comment = queries.getClassComment(session, word);
      if (comment) {
        const preview = comment.length > 500
          ? comment.substring(0, 500) + '...'
          : comment;
        md.appendMarkdown(preview);
      }
    } catch { /* class not found */ }
    return new vscode.Hover(md);
  }
}
