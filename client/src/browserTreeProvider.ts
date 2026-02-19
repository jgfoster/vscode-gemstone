import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

// ── Discriminated Union for Tree Nodes ──────────────────────

interface DictionaryNode {
  kind: 'dictionary';
  sessionId: number;
  dictIndex: number;   // 1-based index in SymbolList
  name: string;
}

interface ClassCategoryNode {
  kind: 'classCategory';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  name: string;           // category name, or '** ALL CLASSES **'
}

interface ClassNode {
  kind: 'class';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  name: string;
}

interface SideNode {
  kind: 'side';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  environmentId: number;
}

interface CategoryNode {
  kind: 'category';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  environmentId: number;
  name: string;
}

interface DefinitionNode {
  kind: 'definition';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
}

interface CommentNode {
  kind: 'comment';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
}

interface MethodNode {
  kind: 'method';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  environmentId: number;
  category: string;
  selector: string;
}

interface GlobalNode {
  kind: 'global';
  sessionId: number;
  dictIndex: number;
  dictName: string;
  name: string;
}

export type BrowserNode =
  | DictionaryNode
  | ClassCategoryNode
  | ClassNode
  | DefinitionNode
  | CommentNode
  | SideNode
  | CategoryNode
  | MethodNode
  | GlobalNode;

// ── Helpers ─────────────────────────────────────────────────

function getMaxEnvironment(): number {
  return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
}

/** Deterministic ID for tree item identity (uses dictName, not dictIndex). */
function nodeId(node: BrowserNode): string {
  switch (node.kind) {
    case 'dictionary':
      return `dict/${node.sessionId}/${node.name}`;
    case 'classCategory':
      return `classcat/${node.sessionId}/${node.dictName}/${node.name}`;
    case 'class':
      return `class/${node.sessionId}/${node.dictName}/${node.name}`;
    case 'definition':
      return `def/${node.sessionId}/${node.dictName}/${node.className}`;
    case 'comment':
      return `comment/${node.sessionId}/${node.dictName}/${node.className}`;
    case 'side':
      return `side/${node.sessionId}/${node.dictName}/${node.className}/${node.isMeta ? 1 : 0}/${node.environmentId}`;
    case 'category':
      return `mcat/${node.sessionId}/${node.dictName}/${node.className}/${node.isMeta ? 1 : 0}/${node.environmentId}/${node.name}`;
    case 'method':
      return `method/${node.sessionId}/${node.dictName}/${node.className}/${node.isMeta ? 1 : 0}/${node.environmentId}/${node.category}/${node.selector}`;
    case 'global':
      return `global/${node.sessionId}/${node.dictName}/${node.name}`;
  }
}

/** Short segment for a node, unique among siblings. Used to build path-based IDs. */
function nodeSegment(node: BrowserNode): string {
  switch (node.kind) {
    case 'dictionary':
      return `d:${node.sessionId}:${node.name}`;
    case 'classCategory':
      return `cc:${node.name}`;
    case 'class':
      return `c:${node.name}`;
    case 'definition':
      return 'def';
    case 'comment':
      return 'com';
    case 'side':
      return `s:${node.isMeta ? 1 : 0}:${node.environmentId}`;
    case 'category':
      return `cat:${node.name}`;
    case 'method':
      return `m:${node.selector}`;
    case 'global':
      return `g:${node.name}`;
  }
}

// ── TreeItem mapping ────────────────────────────────────────

function toTreeItem(node: BrowserNode): vscode.TreeItem {
  switch (node.kind) {
    case 'dictionary': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      item.contextValue = 'gemstoneDictionary';
      return item;
    }
    case 'classCategory': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-folder');
      const isVirtual = node.name === '** ALL CLASSES **' || node.name === '** OTHER GLOBALS **';
      item.contextValue = isVirtual ? 'gemstoneClassCategory' : 'gemstoneClassCategoryNamed';
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
        command: 'gemstone.openDocument',
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
        command: 'gemstone.openDocument',
        title: 'Open Class Comment',
        arguments: [uri],
      };
      item.tooltip = `${node.className} comment`;
      return item;
    }
    case 'side': {
      const maxEnv = getMaxEnvironment();
      const base = node.isMeta ? 'class' : 'instance';
      const label = maxEnv > 0 ? `${base} ${node.environmentId}` : base;
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
      let uriStr =
        `gemstone://${node.sessionId}` +
        `/${encodeURIComponent(node.dictName)}` +
        `/${encodeURIComponent(node.className)}` +
        `/${side}` +
        `/${encodeURIComponent(node.category)}` +
        `/${encodeURIComponent(node.selector)}`;
      if (node.environmentId > 0) {
        uriStr += `?env=${node.environmentId}`;
      }
      const uri = vscode.Uri.parse(uriStr);
      item.command = {
        command: 'gemstone.openDocument',
        title: 'Open Method',
        arguments: [uri],
      };
      item.tooltip = `${node.className}${node.isMeta ? ' class' : ''}>>#${node.selector}`;
      return item;
    }
    case 'global': {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('symbol-variable');
      item.contextValue = 'gemstoneGlobal';
      item.tooltip = `${node.dictName} → ${node.name}`;
      item.command = {
        command: 'gemstone.inspectGlobal',
        title: 'Inspect',
        arguments: [node],
      };
      return item;
    }
  }
}

// ── TreeDataProvider ────────────────────────────────────────

// Per-class cache of bulk environment data
// Key: `${isMeta?1:0}|${envId}|${categoryName}` → sorted selectors
interface EnvCacheEntry {
  categories: Map<string, string[]>;
}

// Per-dictionary cache of classes grouped by class category + non-class globals
// Key: `${sessionId}/${dictIndex}`
interface ClassCategoryCacheEntry {
  categories: Map<string, string[]>;  // classCategoryName → sorted class names
  globals: string[];                   // sorted non-class global names
}

const TREE_MIME = 'application/vnd.code.tree.gemstonebrowser';

export class BrowserTreeProvider
  implements vscode.TreeDataProvider<BrowserNode>, vscode.TreeDragAndDropController<BrowserNode> {

  private _onDidChangeTreeData = new vscode.EventEmitter<BrowserNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private envCache = new Map<string, EnvCacheEntry>();
  private classCategoryCache = new Map<string, ClassCategoryCacheEntry>();
  private pathIds = new Map<BrowserNode, string>();

  // TreeDragAndDropController
  readonly dropMimeTypes = [TREE_MIME];
  readonly dragMimeTypes = [TREE_MIME];

  constructor(private sessionManager: SessionManager) {
    sessionManager.onDidChangeSelection(() => this.refresh());
  }

  handleDrag(source: readonly BrowserNode[], dataTransfer: vscode.DataTransfer): void {
    const allMethods = source.every(n => n.kind === 'method');
    const allClasses = source.every(n => n.kind === 'class');
    if (!allMethods && !allClasses) return;
    dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(source));
  }

  async handleDrop(target: BrowserNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!target) return;
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    const item = dataTransfer.get(TREE_MIME);
    if (!item) return;
    const nodes: BrowserNode[] = item.value;
    if (!nodes || nodes.length === 0) return;

    try {
      if (nodes[0].kind === 'method' && target.kind === 'category') {
        this.dropMethodsOnCategory(session, nodes as MethodNode[], target as CategoryNode);
      } else if (nodes[0].kind === 'class' && target.kind === 'dictionary') {
        this.dropClassesOnDictionary(session, nodes as ClassNode[], target as DictionaryNode);
      } else if (nodes[0].kind === 'class' && target.kind === 'classCategory') {
        this.dropClassesOnClassCategory(session, nodes as ClassNode[], target as ClassCategoryNode);
      } else {
        return;
      }
      this.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Drop failed: ${msg}`);
    }
  }

  private dropMethodsOnCategory(
    session: ActiveSession, methods: MethodNode[], target: CategoryNode,
  ): void {
    if (target.name === '** ALL METHODS **') return;
    for (const m of methods) {
      if (m.className !== target.className ||
          m.isMeta !== target.isMeta ||
          m.environmentId !== target.environmentId) continue;
      if (m.category === target.name) continue;
      queries.recategorizeMethod(session, m.className, m.isMeta, m.selector, target.name);
    }
  }

  private dropClassesOnDictionary(
    session: ActiveSession, classes: ClassNode[], target: DictionaryNode,
  ): void {
    for (const c of classes) {
      if (c.dictIndex === target.dictIndex) continue;
      queries.moveClass(session, c.dictIndex, target.dictIndex, c.name);
    }
  }

  private dropClassesOnClassCategory(
    session: ActiveSession, classes: ClassNode[], target: ClassCategoryNode,
  ): void {
    if (target.name === '** ALL CLASSES **' || target.name === '** OTHER GLOBALS **') return;
    for (const c of classes) {
      queries.reclassifyClass(session, c.dictIndex, c.name, target.name);
    }
  }

  refresh(): void {
    this.envCache.clear();
    this.classCategoryCache.clear();
    this.pathIds.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  getParent(element: BrowserNode): BrowserNode | null {
    let parent: BrowserNode | null;
    switch (element.kind) {
      case 'dictionary':
        return null;
      case 'classCategory':
        parent = {
          kind: 'dictionary',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          name: element.dictName,
        };
        break;
      case 'class':
        parent = {
          kind: 'classCategory',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          dictName: element.dictName,
          name: '** ALL CLASSES **',
        };
        break;
      case 'definition':
      case 'comment':
        parent = {
          kind: 'class',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          dictName: element.dictName,
          name: element.className,
        };
        break;
      case 'side':
        parent = {
          kind: 'class',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          dictName: element.dictName,
          name: element.className,
        };
        break;
      case 'category':
        parent = {
          kind: 'side',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          dictName: element.dictName,
          className: element.className,
          isMeta: element.isMeta,
          environmentId: element.environmentId,
        };
        break;
      case 'method':
        parent = {
          kind: 'category',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          dictName: element.dictName,
          className: element.className,
          isMeta: element.isMeta,
          environmentId: element.environmentId,
          name: element.category,
        };
        break;
      case 'global':
        parent = {
          kind: 'classCategory',
          sessionId: element.sessionId,
          dictIndex: element.dictIndex,
          dictName: element.dictName,
          name: '** OTHER GLOBALS **',
        };
        break;
    }

    // Derive parent's path ID by stripping the last segment from the child's path
    const childPath = this.pathIds.get(element);
    if (childPath && parent) {
      const lastSlash = childPath.lastIndexOf('/');
      if (lastSlash >= 0) {
        this.pathIds.set(parent, childPath.substring(0, lastSlash));
      }
    }

    return parent;
  }

  /** Construct the leaf BrowserNode for a gemstone:// URI, with path ID for reveal(). */
  nodeForUri(uri: vscode.Uri): BrowserNode | null {
    if (uri.scheme !== 'gemstone') return null;

    const sessionId = parseInt(uri.authority, 10);
    if (isNaN(sessionId)) return null;

    const parts = uri.path.split('/').map(decodeURIComponent);
    // parts[0] = '' (leading slash)
    // parts[1] = dictName
    // parts[2] = className
    // parts[3] = side | 'definition' | 'comment' | 'new-class'
    // parts[4] = category
    // parts[5] = selector | 'new-method'
    if (parts.length < 3) return null;

    const dictName = parts[1];
    const className = parts[2];
    if (className === 'new-class') return null;

    // Path through "** ALL CLASSES **" class category (reliable for any class)
    const classPrefix =
      `d:${sessionId}:${dictName}/cc:** ALL CLASSES **/c:${className}`;

    if (parts.length === 4) {
      if (parts[3] === 'definition') {
        const node: BrowserNode = { kind: 'definition', sessionId, dictIndex: 0, dictName, className };
        this.pathIds.set(node, `${classPrefix}/def`);
        return node;
      }
      if (parts[3] === 'comment') {
        const node: BrowserNode = { kind: 'comment', sessionId, dictIndex: 0, dictName, className };
        this.pathIds.set(node, `${classPrefix}/com`);
        return node;
      }
      return null;
    }

    if (parts.length === 6) {
      if (parts[5] === 'new-method') return null;
      const isMeta = parts[3] === 'class';
      const category = parts[4];
      const selector = parts[5];
      const envParam = new URLSearchParams(uri.query).get('env');
      const environmentId = envParam ? parseInt(envParam, 10) : 0;
      const node: BrowserNode = {
        kind: 'method',
        sessionId,
        dictIndex: 0,
        dictName,
        className,
        isMeta,
        environmentId,
        category,
        selector,
      };
      this.pathIds.set(node,
        `${classPrefix}/s:${isMeta ? 1 : 0}:${environmentId}/cat:${category}/m:${selector}`);
      return node;
    }

    return null;
  }

  getTreeItem(element: BrowserNode): vscode.TreeItem {
    const item = toTreeItem(element);
    item.id = this.pathIds.get(element) ?? nodeId(element);
    return item;
  }

  async getChildren(element?: BrowserNode): Promise<BrowserNode[]> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return [];

    try {
      let children: BrowserNode[];
      if (!element) {
        children = this.getDictionaries(session);
      } else {
        switch (element.kind) {
          case 'dictionary':
            children = this.getClassCategories(session, element);
            break;
          case 'classCategory':
            children = this.getClassesInCategory(element);
            break;
          case 'class':
            children = this.getSides(element);
            break;
          case 'side':
            children = this.getCategories(session, element);
            break;
          case 'category':
            children = this.getMethods(session, element);
            break;
          case 'definition':
          case 'comment':
          case 'method':
          case 'global':
            children = [];
            break;
        }
      }

      // Compute path-based IDs for all children
      const parentPath = element ? this.pathIds.get(element) : undefined;
      for (const child of children) {
        const seg = nodeSegment(child);
        this.pathIds.set(child, parentPath ? `${parentPath}/${seg}` : seg);
      }

      return children;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Browser query failed: ${msg}`);
      return [];
    }
  }

  private getDictionaries(session: ActiveSession): BrowserNode[] {
    return queries.getDictionaryNames(session).map((name, i) => ({
      kind: 'dictionary' as const,
      sessionId: session.id,
      dictIndex: i + 1,  // Smalltalk SymbolList is 1-based
      name,
    }));
  }

  private getOrFetchClassCategoryCache(
    session: ActiveSession, dict: DictionaryNode,
  ): ClassCategoryCacheEntry {
    const cacheKey = `${dict.sessionId}/${dict.dictIndex}`;
    let entry = this.classCategoryCache.get(cacheKey);
    if (entry) return entry;

    const lines = queries.getDictionaryEntries(session, dict.dictIndex);
    entry = { categories: new Map(), globals: [] };
    for (const { isClass, category, name } of lines) {
      if (isClass) {
        const cat = category || '';
        let list = entry.categories.get(cat);
        if (!list) {
          list = [];
          entry.categories.set(cat, list);
        }
        list.push(name);
      } else {
        entry.globals.push(name);
      }
    }
    // Sort class names within each category, and globals
    for (const list of entry.categories.values()) {
      list.sort();
    }
    entry.globals.sort();
    this.classCategoryCache.set(cacheKey, entry);
    return entry;
  }

  private getClassCategories(session: ActiveSession, dict: DictionaryNode): BrowserNode[] {
    const entry = this.getOrFetchClassCategoryCache(session, dict);
    const nodes: BrowserNode[] = [{
      kind: 'classCategory' as const,
      sessionId: dict.sessionId,
      dictIndex: dict.dictIndex,
      dictName: dict.name,
      name: '** ALL CLASSES **',
    }];

    const catNames = [...entry.categories.keys()].sort();
    for (const name of catNames) {
      nodes.push({
        kind: 'classCategory' as const,
        sessionId: dict.sessionId,
        dictIndex: dict.dictIndex,
        dictName: dict.name,
        name,
      });
    }

    if (entry.globals.length > 0) {
      nodes.push({
        kind: 'classCategory' as const,
        sessionId: dict.sessionId,
        dictIndex: dict.dictIndex,
        dictName: dict.name,
        name: '** OTHER GLOBALS **',
      });
    }

    return nodes;
  }

  private getClassesInCategory(catNode: ClassCategoryNode): BrowserNode[] {
    const cacheKey = `${catNode.sessionId}/${catNode.dictIndex}`;
    const entry = this.classCategoryCache.get(cacheKey);
    if (!entry) return [];

    if (catNode.name === '** OTHER GLOBALS **') {
      return entry.globals.map(name => ({
        kind: 'global' as const,
        sessionId: catNode.sessionId,
        dictIndex: catNode.dictIndex,
        dictName: catNode.dictName,
        name,
      }));
    }

    let classNames: string[];
    if (catNode.name === '** ALL CLASSES **') {
      const all = new Set<string>();
      for (const list of entry.categories.values()) {
        for (const name of list) all.add(name);
      }
      classNames = [...all].sort();
    } else {
      classNames = entry.categories.get(catNode.name) ?? [];
    }

    return classNames.map(name => ({
      kind: 'class' as const,
      sessionId: catNode.sessionId,
      dictIndex: catNode.dictIndex,
      dictName: catNode.dictName,
      name,
    }));
  }

  private getSides(classNode: ClassNode): BrowserNode[] {
    const maxEnv = getMaxEnvironment();
    const nodes: BrowserNode[] = [
      {
        kind: 'definition' as const,
        sessionId: classNode.sessionId,
        dictIndex: classNode.dictIndex,
        dictName: classNode.dictName,
        className: classNode.name,
      },
      {
        kind: 'comment' as const,
        sessionId: classNode.sessionId,
        dictIndex: classNode.dictIndex,
        dictName: classNode.dictName,
        className: classNode.name,
      },
    ];

    if (maxEnv === 0) {
      nodes.push(
        {
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: false,
          environmentId: 0,
        },
        {
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: true,
          environmentId: 0,
        },
      );
    } else {
      for (let env = 0; env <= maxEnv; env++) {
        nodes.push({
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: false,
          environmentId: env,
        });
      }
      for (let env = 0; env <= maxEnv; env++) {
        nodes.push({
          kind: 'side' as const,
          sessionId: classNode.sessionId,
          dictIndex: classNode.dictIndex,
          dictName: classNode.dictName,
          className: classNode.name,
          isMeta: true,
          environmentId: env,
        });
      }
    }

    return nodes;
  }

  private getCategories(session: ActiveSession, side: SideNode): BrowserNode[] {
    const maxEnv = getMaxEnvironment();
    const allNode: BrowserNode = {
      kind: 'category' as const,
      sessionId: side.sessionId,
      dictIndex: side.dictIndex,
      dictName: side.dictName,
      className: side.className,
      isMeta: side.isMeta,
      environmentId: side.environmentId,
      name: '** ALL METHODS **',
    };

    const entry = this.getOrFetchEnvCache(session, side, maxEnv);
    const prefix = `${side.isMeta ? 1 : 0}|${side.environmentId}|`;
    const categories: string[] = [];
    for (const key of entry.categories.keys()) {
      if (key.startsWith(prefix)) {
        categories.push(key.substring(prefix.length));
      }
    }
    categories.sort();

    const cats = categories.map(name => ({
      kind: 'category' as const,
      sessionId: side.sessionId,
      dictIndex: side.dictIndex,
      dictName: side.dictName,
      className: side.className,
      isMeta: side.isMeta,
      environmentId: side.environmentId,
      name,
    }));
    return [allNode, ...cats];
  }

  private getMethods(session: ActiveSession, cat: CategoryNode): BrowserNode[] {
    const maxEnv = getMaxEnvironment();
    const entry = this.getOrFetchEnvCache(session, cat, maxEnv);

    if (cat.name === '** ALL METHODS **') {
      return this.getAllMethodsFromCache(cat, entry);
    }

    const key = `${cat.isMeta ? 1 : 0}|${cat.environmentId}|${cat.name}`;
    const selectors = entry.categories.get(key) ?? [];

    return selectors.map(selector => ({
      kind: 'method' as const,
      sessionId: cat.sessionId,
      dictIndex: cat.dictIndex,
      dictName: cat.dictName,
      className: cat.className,
      isMeta: cat.isMeta,
      environmentId: cat.environmentId,
      category: cat.name,
      selector,
    }));
  }

  private getAllMethodsFromCache(cat: CategoryNode, entry: EnvCacheEntry): BrowserNode[] {
    const prefix = `${cat.isMeta ? 1 : 0}|${cat.environmentId}|`;
    const methods: BrowserNode[] = [];

    for (const [key, selectors] of entry.categories) {
      if (!key.startsWith(prefix)) continue;
      const realCategory = key.substring(prefix.length);
      for (const selector of selectors) {
        methods.push({
          kind: 'method' as const,
          sessionId: cat.sessionId,
          dictIndex: cat.dictIndex,
          dictName: cat.dictName,
          className: cat.className,
          isMeta: cat.isMeta,
          environmentId: cat.environmentId,
          category: realCategory,
          selector,
        });
      }
    }

    methods.sort((a, b) => {
      if (a.kind !== 'method' || b.kind !== 'method') return 0;
      return a.selector.localeCompare(b.selector);
    });
    return methods;
  }

  private getOrFetchEnvCache(
    session: ActiveSession,
    node: { dictIndex: number; className: string; sessionId: number },
    maxEnv: number,
  ): EnvCacheEntry {
    const cacheKey = `${node.sessionId}/${node.dictIndex}/${node.className}`;
    let entry = this.envCache.get(cacheKey);
    if (entry) return entry;

    const lines = queries.getClassEnvironments(session, node.dictIndex, node.className, maxEnv);
    entry = { categories: new Map() };
    for (const line of lines) {
      const key = `${line.isMeta ? 1 : 0}|${line.envId}|${line.category}`;
      entry.categories.set(key, line.selectors);
    }
    this.envCache.set(cacheKey, entry);
    return entry;
  }
}
