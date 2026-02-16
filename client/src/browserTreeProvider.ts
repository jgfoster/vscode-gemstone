import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

// ── Discriminated Union for Tree Nodes ──────────────────────

interface DictionaryNode {
  kind: 'dictionary';
  sessionId: number;
  name: string;
}

interface ClassNode {
  kind: 'class';
  sessionId: number;
  dictName: string;
  name: string;
}

interface SideNode {
  kind: 'side';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
}

interface CategoryNode {
  kind: 'category';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  name: string;
}

interface DefinitionNode {
  kind: 'definition';
  sessionId: number;
  dictName: string;
  className: string;
}

interface CommentNode {
  kind: 'comment';
  sessionId: number;
  dictName: string;
  className: string;
}

interface MethodNode {
  kind: 'method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  selector: string;
}

export type BrowserNode =
  | DictionaryNode
  | ClassNode
  | DefinitionNode
  | CommentNode
  | SideNode
  | CategoryNode
  | MethodNode;

// ── TreeItem mapping ────────────────────────────────────────

function toTreeItem(node: BrowserNode): vscode.TreeItem {
  switch (node.kind) {
    case 'dictionary': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      item.contextValue = 'gemstoneDictionary';
      return item;
    }
    case 'class': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-class');
      item.contextValue = 'gemstoneClass';
      return item;
    }
    case 'definition': {
      const item = new vscode.TreeItem('definition', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-structure');
      item.contextValue = 'gemstoneDefinition';
      const uri = vscode.Uri.parse(
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/definition`
      );
      item.command = {
        command: 'vscode.open',
        title: 'Open Class Definition',
        arguments: [uri],
      };
      item.tooltip = `${node.className} definition`;
      return item;
    }
    case 'comment': {
      const item = new vscode.TreeItem('comment', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('comment');
      item.contextValue = 'gemstoneComment';
      const uri = vscode.Uri.parse(
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/comment`
      );
      item.command = {
        command: 'vscode.open',
        title: 'Open Class Comment',
        arguments: [uri],
      };
      item.tooltip = `${node.className} comment`;
      return item;
    }
    case 'side': {
      const label = node.isMeta ? 'class' : 'instance';
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(node.isMeta ? 'symbol-interface' : 'symbol-method');
      item.contextValue = 'gemstoneSide';
      return item;
    }
    case 'category': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-folder');
      item.contextValue = 'gemstoneCategory';
      return item;
    }
    case 'method': {
      const item = new vscode.TreeItem(node.selector, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-method');
      item.contextValue = 'gemstoneMethod';
      const side = node.isMeta ? 'class' : 'instance';
      const uri = vscode.Uri.parse(
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/${side}` +
        `/${encodeURIComponent(node.category)}` +
        `/${encodeURIComponent(node.selector)}`
      );
      item.command = {
        command: 'vscode.open',
        title: 'Open Method',
        arguments: [uri],
      };
      item.tooltip = `${node.className}${node.isMeta ? ' class' : ''}>>#${node.selector}`;
      return item;
    }
  }
}

// ── TreeDataProvider ────────────────────────────────────────

export class BrowserTreeProvider implements vscode.TreeDataProvider<BrowserNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BrowserNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private sessionManager: SessionManager) {
    sessionManager.onDidChangeSelection(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BrowserNode): vscode.TreeItem {
    return toTreeItem(element);
  }

  async getChildren(element?: BrowserNode): Promise<BrowserNode[]> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    try {
      if (!element) {
        return this.getDictionaries(session);
      }
      switch (element.kind) {
        case 'dictionary':
          return this.getClasses(session, element);
        case 'class':
          return this.getSides(element);
        case 'side':
          return this.getCategories(session, element);
        case 'category':
          return this.getMethods(session, element);
        case 'definition':
        case 'comment':
        case 'method':
          return [];
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Browser query failed: ${msg}`);
      return [];
    }
  }

  private getDictionaries(session: ActiveSession): BrowserNode[] {
    return queries.getDictionaryNames(session).map(name => ({
      kind: 'dictionary' as const,
      sessionId: session.id,
      name,
    }));
  }

  private getClasses(session: ActiveSession, dict: DictionaryNode): BrowserNode[] {
    return queries.getClassNames(session, dict.name).map(name => ({
      kind: 'class' as const,
      sessionId: session.id,
      dictName: dict.name,
      name,
    }));
  }

  private getSides(classNode: ClassNode): BrowserNode[] {
    return [
      {
        kind: 'definition' as const,
        sessionId: classNode.sessionId,
        dictName: classNode.dictName,
        className: classNode.name,
      },
      {
        kind: 'comment' as const,
        sessionId: classNode.sessionId,
        dictName: classNode.dictName,
        className: classNode.name,
      },
      {
        kind: 'side' as const,
        sessionId: classNode.sessionId,
        dictName: classNode.dictName,
        className: classNode.name,
        isMeta: false,
      },
      {
        kind: 'side' as const,
        sessionId: classNode.sessionId,
        dictName: classNode.dictName,
        className: classNode.name,
        isMeta: true,
      },
    ];
  }

  private getCategories(session: ActiveSession, side: SideNode): BrowserNode[] {
    return queries.getMethodCategories(session, side.className, side.isMeta).map(name => ({
      kind: 'category' as const,
      sessionId: side.sessionId,
      dictName: side.dictName,
      className: side.className,
      isMeta: side.isMeta,
      name,
    }));
  }

  private getMethods(session: ActiveSession, cat: CategoryNode): BrowserNode[] {
    return queries.getMethodSelectors(session, cat.className, cat.isMeta, cat.name).map(selector => ({
      kind: 'method' as const,
      sessionId: cat.sessionId,
      dictName: cat.dictName,
      className: cat.className,
      isMeta: cat.isMeta,
      category: cat.name,
      selector,
    }));
  }
}
