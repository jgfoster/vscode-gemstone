import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession } from './sessionManager';
import { ExportManager } from './exportManager';
import { parseTopazDocument } from './topazFileIn';
import * as queries from './browserQueries';

// ── Types ────────────────────────────────────────────────────

interface BrowserState {
  dictionaries: string[];
  selectedDictIndex: number | null;       // 1-based
  classCategories: string[];
  selectedCategory: string | null;
  classes: string[];
  selectedClass: string | null;
  isMeta: boolean;
  methodCategories: string[];
  selectedMethodCategory: string | null;
  methods: string[];
  selectedMethod: string | null;
}

// ── Selector extraction ──────────────────────────────────────

/**
 * Extract the Smalltalk selector from a message pattern (first line of a method).
 *
 *   "name"                   → "name"       (unary)
 *   "+ anObject"             → "+"          (binary)
 *   "at: index put: value"  → "at:put:"    (keyword)
 */
export function extractSelector(messagePattern: string): string {
  const trimmed = messagePattern.trim();
  if (!trimmed) return '';

  // Keyword messages: one or more word: pairs
  const keywords = trimmed.match(/\b([a-zA-Z_]\w*:)/g);
  if (keywords && keywords.length > 0) return keywords.join('');

  // Binary messages: start with special characters
  const binaryMatch = trimmed.match(/^([~!@%&*\-+=|\\<>,?/]+)/);
  if (binaryMatch) return binaryMatch[1];

  // Unary: just the first word
  const unaryMatch = trimmed.match(/^(\w+)/);
  if (unaryMatch) return unaryMatch[1];

  return trimmed;
}

// ── SystemBrowser ────────────────────────────────────────────

export class SystemBrowser {
  private static panels = new Map<number, SystemBrowser>();

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private state: BrowserState;

  // Caches
  private dictEntryCache = new Map<number, queries.DictEntry[]>();
  private envCache = new Map<string, queries.EnvCategoryLine[]>();

  // Dimming
  private dimDecorationType: vscode.TextEditorDecorationType;
  private dimmedEditorUri: string | undefined;

  static show(
    session: ActiveSession,
    exportManager: ExportManager,
  ): void {
    const existing = SystemBrowser.panels.get(session.id);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneSystemBrowser',
      `Browser: ${session.login.label}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    SystemBrowser.panels.set(
      session.id,
      new SystemBrowser(panel, session, exportManager),
    );
  }

  static disposeForSession(sessionId: number): void {
    const browser = SystemBrowser.panels.get(sessionId);
    if (browser) {
      browser.panel.dispose();
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private session: ActiveSession,
    private exportManager: ExportManager,
  ) {
    this.panel = panel;

    this.state = {
      dictionaries: [],
      selectedDictIndex: null,
      classCategories: [],
      selectedCategory: null,
      classes: [],
      selectedClass: null,
      isMeta: false,
      methodCategories: [],
      selectedMethodCategory: null,
      methods: [],
      selectedMethod: null,
    };

    this.dimDecorationType = vscode.window.createTextEditorDecorationType({
      opacity: '0.4',
    });

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    // Clear dimming when user navigates to a different editor
    const editorSub = vscode.window.onDidChangeActiveTextEditor(() => {
      this.clearDimming();
    });
    this.disposables.push(editorSub);
  }

  private dispose(): void {
    SystemBrowser.panels.delete(this.session.id);
    this.clearDimming();
    this.dimDecorationType.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  // ── Message dispatch ──────────────────────────────────────

  private handleMessage(message: { command: string; [key: string]: unknown }): void {
    try {
      switch (message.command) {
        case 'ready':
          this.handleReady();
          break;
        case 'selectDictionary':
          this.handleSelectDictionary(message.index as number);
          break;
        case 'selectCategory':
          this.handleSelectCategory(message.name as string);
          break;
        case 'selectClass':
          this.handleSelectClass(message.name as string);
          break;
        case 'toggleSide':
          this.handleToggleSide(message.isMeta as boolean);
          break;
        case 'selectMethodCategory':
          this.handleSelectMethodCategory(message.name as string);
          break;
        case 'selectMethod':
          this.handleSelectMethod(message.selector as string);
          break;
        case 'refresh':
          this.handleRefresh();
          break;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.panel.webview.postMessage({ command: 'showError', message: msg });
    }
  }

  // ── Handlers ──────────────────────────────────────────────

  private handleReady(): void {
    this.state.dictionaries = queries.getDictionaryNames(this.session);
    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
  }

  private handleSelectDictionary(dictIndex: number): void {
    this.state.selectedDictIndex = dictIndex;
    this.state.selectedCategory = null;
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    const entries = this.getCachedDictEntries(dictIndex);

    // Build unique class categories, sorted
    const categorySet = new Set<string>();
    for (const entry of entries) {
      if (entry.isClass) {
        categorySet.add(entry.category || '');
      }
    }
    const sorted = [...categorySet].sort();
    this.state.classCategories = ['** ALL CLASSES **', ...sorted];

    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
    });
  }

  private handleSelectCategory(category: string): void {
    this.state.selectedCategory = category;
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const entries = this.getCachedDictEntries(dictIndex);
    let classes: string[];
    if (category === '** ALL CLASSES **') {
      classes = entries.filter(e => e.isClass).map(e => e.name);
    } else {
      classes = entries
        .filter(e => e.isClass && (e.category || '') === category)
        .map(e => e.name);
    }
    this.state.classes = classes.sort();

    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
    });
  }

  private handleSelectClass(className: string): void {
    this.state.selectedClass = className;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;

    this.loadMethodCategories();
    this.openClassFile(className);
  }

  private handleToggleSide(isMeta: boolean): void {
    this.state.isMeta = isMeta;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;

    if (this.state.selectedClass) {
      this.loadMethodCategories();
    }
  }

  private handleSelectMethodCategory(category: string): void {
    this.state.selectedMethodCategory = category;
    this.state.selectedMethod = null;
    this.clearDimming();

    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const envData = this.getCachedEnvData(dictIndex, className);
    const filtered = envData.filter(
      e => e.isMeta === this.state.isMeta && e.envId === 0,
    );

    let methods: string[];
    if (category === '** ALL METHODS **') {
      const set = new Set<string>();
      for (const entry of filtered) {
        for (const sel of entry.selectors) set.add(sel);
      }
      methods = [...set].sort();
    } else {
      const entry = filtered.find(e => e.category === category);
      methods = entry ? [...entry.selectors] : [];
    }
    this.state.methods = methods;

    this.panel.webview.postMessage({
      command: 'loadMethods',
      items: this.state.methods,
    });
  }

  private handleSelectMethod(selector: string): void {
    this.state.selectedMethod = selector;

    const className = this.state.selectedClass;
    if (!className) return;

    this.openClassFile(className, selector, this.state.isMeta);
  }

  private handleRefresh(): void {
    this.dictEntryCache.clear();
    this.envCache.clear();
    this.clearDimming();

    this.state = {
      dictionaries: [],
      selectedDictIndex: null,
      classCategories: [],
      selectedCategory: null,
      classes: [],
      selectedClass: null,
      isMeta: false,
      methodCategories: [],
      selectedMethodCategory: null,
      methods: [],
      selectedMethod: null,
    };

    this.handleReady();
  }

  // ── Data helpers ──────────────────────────────────────────

  private getCachedDictEntries(dictIndex: number): queries.DictEntry[] {
    let entries = this.dictEntryCache.get(dictIndex);
    if (!entries) {
      entries = queries.getDictionaryEntries(this.session, dictIndex);
      this.dictEntryCache.set(dictIndex, entries);
    }
    return entries;
  }

  private getCachedEnvData(dictIndex: number, className: string): queries.EnvCategoryLine[] {
    const key = `${dictIndex}/${className}`;
    let data = this.envCache.get(key);
    if (!data) {
      data = queries.getClassEnvironments(this.session, dictIndex, className, 0);
      this.envCache.set(key, data);
    }
    return data;
  }

  private loadMethodCategories(): void {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const envData = this.getCachedEnvData(dictIndex, className);
    const filtered = envData.filter(
      e => e.isMeta === this.state.isMeta && e.envId === 0,
    );

    const categories = filtered.map(e => e.category).sort();
    this.state.methodCategories = ['** ALL METHODS **', ...categories];

    this.panel.webview.postMessage({
      command: 'loadMethodCategories',
      items: this.state.methodCategories,
    });
  }

  // ── File navigation + dimming ─────────────────────────────

  private openClassFile(
    className: string,
    selector?: string,
    isMeta?: boolean,
  ): void {
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (!sessionRoot) return;

    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const dictName = this.state.dictionaries[dictIndex - 1];
    const dictLabel = `${dictIndex}. ${dictName}`;
    const filePath = path.join(sessionRoot, dictLabel, `${className}.gs`);

    if (!fs.existsSync(filePath)) return;

    const uri = vscode.Uri.file(filePath);

    if (!selector) {
      // Open at top (class definition)
      this.clearDimming();
      vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
        preserveFocus: true,
      });
      return;
    }

    // Parse file and find the matching method
    const content = fs.readFileSync(filePath, 'utf-8');
    const regions = parseTopazDocument(content);

    const targetCommand = isMeta ? 'classmethod' : 'method';
    const matchingRegion = regions.find(r => {
      if (r.kind !== 'smalltalk-method') return false;
      if (r.command !== targetCommand) return false;
      if (r.className !== className) return false;
      const firstLine = r.text.split('\n')[0]?.trim() ?? '';
      return extractSelector(firstLine) === selector;
    });

    if (!matchingRegion) return;

    vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
      preserveFocus: true,
      selection: new vscode.Range(
        matchingRegion.startLine, 0,
        matchingRegion.startLine, 0,
      ),
    }).then(editor => {
      this.applyDimming(editor, matchingRegion.startLine, matchingRegion.endLine);
    });
  }

  private applyDimming(
    editor: vscode.TextEditor,
    methodStartLine: number,
    methodEndLine: number,
  ): void {
    const ranges: vscode.Range[] = [];
    const lastLine = editor.document.lineCount - 1;

    if (methodStartLine > 0) {
      ranges.push(new vscode.Range(0, 0, methodStartLine - 1, Number.MAX_SAFE_INTEGER));
    }

    if (methodEndLine < lastLine) {
      ranges.push(new vscode.Range(methodEndLine + 1, 0, lastLine, Number.MAX_SAFE_INTEGER));
    }

    editor.setDecorations(this.dimDecorationType, ranges);
    this.dimmedEditorUri = editor.document.uri.toString();
  }

  private clearDimming(): void {
    if (!this.dimmedEditorUri) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === this.dimmedEditorUri) {
        editor.setDecorations(this.dimDecorationType, []);
      }
    }
    this.dimmedEditorUri = undefined;
  }

  // ── HTML generation ───────────────────────────────────────

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>System Browser</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      gap: 6px;
      flex-shrink: 0;
    }

    .toolbar button {
      padding: 2px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .toolbar .session-label {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-left: auto;
    }

    .columns {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .column {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--vscode-panel-border);
      min-width: 0;
    }

    .column:last-child {
      border-right: none;
    }

    .column-header {
      padding: 4px 8px;
      font-weight: 600;
      font-size: 0.8em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .column-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .column-list .item {
      padding: 1px 8px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
    }

    .column-list .item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .column-list .item.selected {
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .column-list .item.virtual {
      font-style: italic;
      color: var(--vscode-descriptionForeground);
    }

    .column-list .item.virtual.selected {
      color: var(--vscode-list-activeSelectionForeground);
    }

    .column-footer {
      padding: 4px 8px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 12px;
      flex-shrink: 0;
    }

    .column-footer label {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      font-size: 0.9em;
    }

    .column-footer input[type="radio"] {
      accent-color: var(--vscode-focusBorder);
    }

    .loading {
      padding: 8px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .error-banner {
      padding: 6px 10px;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #f88);
      border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      font-size: 0.9em;
      display: none;
    }
  </style>
</head>
<body>
  <div class="error-banner" id="errorBanner"></div>
  <div class="toolbar">
    <button id="refreshBtn" title="Refresh">&#x21bb; Refresh</button>
    <span class="session-label" id="sessionLabel"></span>
  </div>
  <div class="columns">
    <div class="column">
      <div class="column-header">Dictionaries</div>
      <div class="column-list" id="list-dicts"></div>
    </div>
    <div class="column">
      <div class="column-header">Class Categories</div>
      <div class="column-list" id="list-categories"></div>
    </div>
    <div class="column">
      <div class="column-header">Classes</div>
      <div class="column-list" id="list-classes"></div>
      <div class="column-footer">
        <label><input type="radio" name="side" value="instance" checked> Instance</label>
        <label><input type="radio" name="side" value="class"> Class</label>
      </div>
    </div>
    <div class="column">
      <div class="column-header">Method Categories</div>
      <div class="column-list" id="list-method-cats"></div>
    </div>
    <div class="column">
      <div class="column-header">Methods</div>
      <div class="column-list" id="list-methods"></div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ── Column references ──────────────────────────
    const cols = {
      dicts:      document.getElementById('list-dicts'),
      categories: document.getElementById('list-categories'),
      classes:    document.getElementById('list-classes'),
      methodCats: document.getElementById('list-method-cats'),
      methods:    document.getElementById('list-methods'),
    };

    const errorBanner = document.getElementById('errorBanner');

    // ── Populate a column with items ───────────────
    function populateColumn(listEl, items, virtualItems) {
      listEl.innerHTML = '';
      const virtualSet = new Set(virtualItems || []);
      for (const item of items) {
        const div = document.createElement('div');
        div.className = 'item' + (virtualSet.has(item) ? ' virtual' : '');
        div.textContent = item;
        div.dataset.value = item;
        listEl.appendChild(div);
      }
    }

    // ── Clear columns to the right ─────────────────
    function clearFrom(startCol) {
      const order = ['dicts', 'categories', 'classes', 'methodCats', 'methods'];
      const idx = order.indexOf(startCol);
      for (let i = idx; i < order.length; i++) {
        cols[order[i]].innerHTML = '';
      }
    }

    // ── Selection handler ──────────────────────────
    function setupClickHandler(listEl, callback) {
      listEl.addEventListener('click', (e) => {
        const item = e.target.closest('.item');
        if (!item) return;
        // Deselect previous
        const prev = listEl.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        callback(item.dataset.value);
      });
    }

    setupClickHandler(cols.dicts, (name) => {
      const idx = Array.from(cols.dicts.children).findIndex(
        el => el.dataset.value === name
      );
      vscode.postMessage({ command: 'selectDictionary', index: idx + 1 });
    });

    setupClickHandler(cols.categories, (name) => {
      vscode.postMessage({ command: 'selectCategory', name });
    });

    setupClickHandler(cols.classes, (name) => {
      vscode.postMessage({ command: 'selectClass', name });
    });

    setupClickHandler(cols.methodCats, (name) => {
      vscode.postMessage({ command: 'selectMethodCategory', name });
    });

    setupClickHandler(cols.methods, (selector) => {
      vscode.postMessage({ command: 'selectMethod', selector });
    });

    // ── Instance / Class toggle ────────────────────
    document.querySelectorAll('input[name="side"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        vscode.postMessage({
          command: 'toggleSide',
          isMeta: e.target.value === 'class',
        });
      });
    });

    // ── Refresh button ─────────────────────────────
    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    // ── Message receiver ───────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'loadDictionaries':
          clearFrom('dicts');
          populateColumn(cols.dicts, msg.items, []);
          break;
        case 'loadClassCategories':
          clearFrom('categories');
          populateColumn(cols.categories, msg.items, ['** ALL CLASSES **']);
          break;
        case 'loadClasses':
          clearFrom('classes');
          populateColumn(cols.classes, msg.items, []);
          break;
        case 'loadMethodCategories':
          clearFrom('methodCats');
          populateColumn(cols.methodCats, msg.items, ['** ALL METHODS **']);
          break;
        case 'loadMethods':
          cols.methods.innerHTML = '';
          populateColumn(cols.methods, msg.items, []);
          break;
        case 'showError':
          errorBanner.textContent = msg.message;
          errorBanner.style.display = 'block';
          setTimeout(() => { errorBanner.style.display = 'none'; }, 5000);
          break;
        case 'setSessionLabel':
          document.getElementById('sessionLabel').textContent = msg.label;
          break;
      }
    });

    // ── Initial load ───────────────────────────────
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
