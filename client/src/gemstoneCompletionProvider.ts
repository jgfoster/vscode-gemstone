import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

export class GemStoneCompletionProvider implements vscode.CompletionItemProvider {
  private classNameCache = new Map<unknown, vscode.CompletionItem[]>();
  private selectorCache = new Map<string, vscode.CompletionItem[]>();
  private instVarCache = new Map<string, vscode.CompletionItem[]>();

  constructor(private sessionManager: SessionManager) {}

  invalidateCache(): void {
    this.classNameCache.clear();
    this.selectorCache.clear();
    this.instVarCache.clear();
  }

  provideCompletionItems(
    document: vscode.TextDocument,
  ): vscode.CompletionItem[] {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    const items: vscode.CompletionItem[] = [];

    items.push(...this.getClassNameItems(session));

    const className = this.extractClassName(document.uri);
    if (className) {
      items.push(...this.getInstVarItems(session, className));
      items.push(...this.getSelectorItems(session, className));
    }

    return items;
  }

  private extractClassName(uri: vscode.Uri): string | null {
    if (uri.scheme !== 'gemstone') return null;
    const parts = uri.path.split('/').filter(s => s.length > 0);
    // path: /{dictName}/{className}/{side}/{category}/{selector}
    if (parts.length < 2) return null;
    return decodeURIComponent(parts[1]);
  }

  private getClassNameItems(session: ActiveSession): vscode.CompletionItem[] {
    const cached = this.classNameCache.get(session.handle);
    if (cached) return cached;

    try {
      const entries = queries.getAllClassNames(session);
      const seen = new Set<string>();
      const items: vscode.CompletionItem[] = [];
      for (const e of entries) {
        if (seen.has(e.className)) continue;
        seen.add(e.className);
        const item = new vscode.CompletionItem(
          e.className, vscode.CompletionItemKind.Class,
        );
        item.detail = e.dictName;
        items.push(item);
      }
      this.classNameCache.set(session.handle, items);
      return items;
    } catch {
      return [];
    }
  }

  private getInstVarItems(session: ActiveSession, className: string): vscode.CompletionItem[] {
    const key = `${session.id}:${className}`;
    const cached = this.instVarCache.get(key);
    if (cached) return cached;

    try {
      const names = queries.getInstVarNames(session, className);
      const items = names.map(name => {
        const item = new vscode.CompletionItem(
          name, vscode.CompletionItemKind.Field,
        );
        item.detail = `${className} inst var`;
        return item;
      });
      this.instVarCache.set(key, items);
      return items;
    } catch {
      return [];
    }
  }

  private getSelectorItems(session: ActiveSession, className: string): vscode.CompletionItem[] {
    const key = `${session.id}:${className}`;
    const cached = this.selectorCache.get(key);
    if (cached) return cached;

    try {
      const selectors = queries.getAllSelectors(session, className);
      const items = selectors.map(sel => new vscode.CompletionItem(
        sel, vscode.CompletionItemKind.Method,
      ));
      this.selectorCache.set(key, items);
      return items;
    } catch {
      return [];
    }
  }
}
