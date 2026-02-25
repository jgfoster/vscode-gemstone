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
  selectedEnvId: number;
  methodCategories: string[];
  selectedMethodCategory: string | null;
  methods: string[];
  selectedMethod: string | null;
  viewMode: 'category' | 'hierarchy';
  hierarchyEntries: queries.ClassHierarchyEntry[];
  hierarchyClassName: string | null;
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
  private syncingFromBrowser = false; // prevent cursor→browser feedback loops

  // Caches
  private dictEntryCache = new Map<number, queries.DictEntry[]>();
  private envCache = new Map<string, queries.EnvCategoryLine[]>();
  private hierarchyCache = new Map<string, queries.ClassHierarchyEntry[]>();

  // Dimming
  private dimDecorationType: vscode.TextEditorDecorationType;
  private dimmedEditorUri: string | undefined;

  /**
   * Refresh the browser for a given session (e.g. after abort or commit).
   */
  static refresh(sessionId: number): void {
    const browser = SystemBrowser.panels.get(sessionId);
    if (browser) browser.handleRefresh();
  }

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
      selectedEnvId: 0,
      methodCategories: [],
      selectedMethodCategory: null,
      methods: [],
      selectedMethod: null,
      viewMode: 'category',
      hierarchyEntries: [],
      hierarchyClassName: null,
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

    // Sync browser webview when cursor moves in a session file
    const selSub = vscode.window.onDidChangeTextEditorSelection(e => {
      this.handleCursorSync(e);
    });
    this.disposables.push(selSub);
  }

  // ── Cursor-based browser sync ──────────────────────────────

  private handleCursorSync(e: vscode.TextEditorSelectionChangeEvent): void {
    if (this.syncingFromBrowser) return;

    const filePath = e.textEditor.document.uri.fsPath;
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (!sessionRoot || !filePath.startsWith(sessionRoot)) return;

    // Parse path: sessionRoot / "N. DictName" / "ClassName.gs"
    const relative = filePath.slice(sessionRoot.length + 1); // skip leading /
    const sep = relative.indexOf(path.sep);
    if (sep < 0) return;
    const dictLabel = relative.slice(0, sep);
    const classFile = relative.slice(sep + 1);
    if (!classFile.endsWith('.gs')) return;
    const className = classFile.slice(0, -3);

    const dotPos = dictLabel.indexOf('.');
    if (dotPos < 0) return;
    const dictIndex = parseInt(dictLabel.slice(0, dotPos), 10);
    if (isNaN(dictIndex)) return;

    // Find which method the cursor is in
    const cursorLine = e.selections[0].active.line;
    const content = e.textEditor.document.getText();
    const regions = parseTopazDocument(content);
    const cursorRegion = regions.find(
      r => r.kind === 'smalltalk-method' && cursorLine >= r.startLine && cursorLine <= r.endLine,
    );

    const selector = cursorRegion
      ? extractSelector(cursorRegion.text.split('\n')[0]?.trim() ?? '')
      : null;
    const isMeta = cursorRegion ? cursorRegion.command === 'classmethod' : this.state.isMeta;

    // Skip if already in sync
    if (this.state.selectedDictIndex === dictIndex &&
      this.state.selectedClass === className &&
      this.state.selectedMethod === (selector ?? null) &&
      this.state.isMeta === isMeta) {
      return;
    }

    // Update dictionary if changed
    if (this.state.selectedDictIndex !== dictIndex) {
      this.handleSelectDictionary(dictIndex);
      this.panel.webview.postMessage({
        command: 'selectDictionaryItem',
        index: dictIndex,
      });
    }

    // Ensure the class is visible — if the current category doesn't include
    // this class, switch to "** ALL CLASSES **"
    if (this.state.selectedClass !== className) {
      if (!this.state.classes.includes(className)) {
        this.handleSelectCategory('** ALL CLASSES **');
      }
      this.state.selectedClass = className;
      this.state.selectedMethodCategory = null;
      this.state.selectedMethod = null;
      this.loadMethodCategories();
    }

    if (isMeta !== this.state.isMeta) {
      this.handleToggleSide(isMeta);
    }

    // Find the method category containing this selector and load its methods
    if (selector) {
      const envData = this.getCachedEnvData(dictIndex, className);
      const matchingEnv = envData.find(
        entry => entry.isMeta === this.state.isMeta &&
          entry.envId === this.state.selectedEnvId &&
          entry.selectors.includes(selector),
      );
      if (matchingEnv && matchingEnv.category !== this.state.selectedMethodCategory) {
        this.handleSelectMethodCategory(matchingEnv.category);
      }
      this.state.selectedMethod = selector;
    } else {
      this.state.selectedMethod = null;
    }

    // Refresh all webview column selections
    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
      selected: this.state.selectedCategory,
    });
    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
      selected: className,
    });
    this.panel.webview.postMessage({
      command: 'loadMethodCategories',
      items: this.state.methodCategories,
      selected: this.state.selectedMethodCategory,
    });
    this.panel.webview.postMessage({
      command: 'loadMethods',
      items: this.state.methods,
      selected: selector,
    });

    // Update dimming to highlight the current method
    if (cursorRegion) {
      this.applyDimming(e.textEditor, cursorRegion.startLine, cursorRegion.endLine);
    } else {
      this.clearDimming();
    }
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
        case 'toggleViewMode':
          this.handleToggleViewMode(message.mode as string);
          break;
        case 'selectHierarchyClass':
          this.handleSelectHierarchyClass(message.className as string);
          break;
        case 'toggleEnvironment':
          this.handleToggleEnvironment(message.envId as number);
          break;
        // Context menu commands
        case 'ctxAddDictionary':
          this.handleAddDictionary().catch(e => this.postError(e));
          break;
        case 'ctxMoveDictUp':
          this.handleMoveDictUp();
          break;
        case 'ctxMoveDictDown':
          this.handleMoveDictDown();
          break;
        case 'ctxRemoveDictionary':
          this.handleRemoveDictionary().catch(e => this.postError(e));
          break;
        case 'ctxNewClassCategory':
          this.handleNewClassCategory().catch(e => this.postError(e));
          break;
        case 'ctxNewClass':
          this.handleNewClass();
          break;
        case 'ctxDeleteClass':
          this.handleDeleteClass().catch(e => this.postError(e));
          break;
        case 'ctxMoveClass':
          this.handleMoveClass().catch(e => this.postError(e));
          break;
        case 'ctxRunTests':
          this.handleRunTests();
          break;
        case 'ctxInspectGlobal':
          this.handleInspectGlobal();
          break;
        case 'ctxNewMethod':
          this.handleNewMethod();
          break;
        case 'ctxRenameCategory':
          this.handleRenameCategory().catch(e => this.postError(e));
          break;
        case 'ctxDeleteMethod':
          this.handleDeleteMethod().catch(e => this.postError(e));
          break;
        case 'ctxMoveToCategory':
          this.handleMoveToCategory().catch(e => this.postError(e));
          break;
        case 'ctxSendersOf':
          this.handleSendersOf();
          break;
        case 'ctxImplementorsOf':
          this.handleImplementorsOf();
          break;
        // Drag-and-drop commands
        case 'dropMethodOnCategory':
          this.handleDropMethodOnCategory(
            message.selector as string,
            message.category as string,
          );
          break;
        case 'dropClassOnDictionary':
          this.handleDropClassOnDictionary(
            message.className as string,
            message.dictName as string,
          );
          break;
      }
    } catch (e: unknown) {
      this.postError(e);
    }
  }

  private postError(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.panel.webview.postMessage({ command: 'showError', message: msg });
  }

  // ── Handlers ──────────────────────────────────────────────

  private handleReady(): void {
    const maxEnv = this.getMaxEnvironment();
    if (maxEnv > 0) {
      this.panel.webview.postMessage({
        command: 'setMaxEnvironment',
        maxEnv,
      });
    }
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
    const hasGlobals = entries.some(e => !e.isClass);
    this.state.classCategories = [
      '** ALL CLASSES **',
      ...sorted,
      ...(hasGlobals ? ['** GLOBALS **'] : []),
    ];

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
    let names: string[];
    if (category === '** GLOBALS **') {
      names = entries.filter(e => !e.isClass).map(e => e.name);
    } else if (category === '** ALL CLASSES **') {
      names = entries.filter(e => e.isClass).map(e => e.name);
    } else {
      names = entries
        .filter(e => e.isClass && (e.category || '') === category)
        .map(e => e.name);
    }
    this.state.classes = names.sort();

    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
    });
  }

  private handleSelectClass(className: string): void {
    this.state.selectedClass = className;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;

    if (this.state.selectedCategory === '** GLOBALS **') {
      // Non-class global — inspect it instead of browsing methods
      vscode.commands.executeCommand('gemstone.inspectGlobal', { className });
      this.panel.webview.postMessage({ command: 'loadMethodCategories', items: [] });
      this.panel.webview.postMessage({ command: 'loadMethods', items: [] });
      return;
    }

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
      e => e.isMeta === this.state.isMeta && e.envId === this.state.selectedEnvId,
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
    const prevDictIndex = this.state.selectedDictIndex;
    const prevCategory = this.state.selectedCategory;

    this.dictEntryCache.clear();
    this.envCache.clear();
    this.hierarchyCache.clear();
    this.clearDimming();

    this.state = {
      dictionaries: [],
      selectedDictIndex: null,
      classCategories: [],
      selectedCategory: null,
      classes: [],
      selectedClass: null,
      isMeta: false,
      selectedEnvId: 0,
      methodCategories: [],
      selectedMethodCategory: null,
      methods: [],
      selectedMethod: null,
      viewMode: 'category',
      hierarchyEntries: [],
      hierarchyClassName: null,
    };

    this.panel.webview.postMessage({ command: 'setViewMode', mode: 'category' });
    this.handleReady();

    // Restore dictionary and category selection so the class list stays visible
    if (prevDictIndex && prevDictIndex <= this.state.dictionaries.length) {
      this.handleSelectDictionary(prevDictIndex);
      this.panel.webview.postMessage({
        command: 'selectDictionaryItem',
        index: prevDictIndex,
      });
      if (prevCategory && this.state.classCategories.includes(prevCategory)) {
        this.handleSelectCategory(prevCategory);
        this.panel.webview.postMessage({
          command: 'selectCategoryItem',
          name: prevCategory,
        });
      }
    }
  }

  private handleToggleViewMode(mode: string): void {
    this.state.viewMode = mode as 'category' | 'hierarchy';

    if (mode === 'hierarchy') {
      if (this.state.selectedClass) {
        this.sendHierarchy(this.state.selectedClass);
      } else {
        this.panel.webview.postMessage({ command: 'setViewMode', mode: 'hierarchy' });
        this.panel.webview.postMessage({
          command: 'loadHierarchy',
          items: [],
          selectedClass: null,
        });
      }
    } else {
      this.panel.webview.postMessage({ command: 'setViewMode', mode: 'category' });
      // Re-send category data so the columns are populated, restoring selection
      if (this.state.selectedDictIndex) {
        this.panel.webview.postMessage({
          command: 'loadClassCategories',
          items: this.state.classCategories,
          selected: this.state.selectedCategory,
        });
        if (this.state.selectedCategory) {
          this.panel.webview.postMessage({
            command: 'loadClasses',
            items: this.state.classes,
            selected: this.state.selectedClass,
          });
          if (this.state.selectedClass) {
            this.loadMethodCategories(this.state.selectedMethodCategory);
            if (this.state.selectedMethodCategory) {
              this.panel.webview.postMessage({
                command: 'loadMethods',
                items: this.state.methods,
                selected: this.state.selectedMethod,
              });
            }
          }
        }
      }
    }
  }

  private handleSelectHierarchyClass(className: string): void {
    // Find which dictionary contains this class from the hierarchy entries
    const entry = this.state.hierarchyEntries.find(e => e.className === className);
    if (!entry) return;

    const dictIndex = this.state.dictionaries.indexOf(entry.dictName) + 1;
    if (dictIndex < 1) return;

    this.state.selectedDictIndex = dictIndex;
    this.state.selectedClass = className;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;

    this.loadMethodCategories();
    this.openClassFile(className);
  }

  private handleToggleEnvironment(envId: number): void {
    this.state.selectedEnvId = envId;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;

    if (this.state.selectedClass) {
      this.loadMethodCategories();
    }
  }

  // ── Context menu handlers ────────────────────────────────

  private async handleAddDictionary(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'New dictionary name',
      placeHolder: 'e.g. MyProject',
    });
    if (!name) return;

    queries.addDictionary(this.session, name);
    this.dictEntryCache.clear();
    this.state.dictionaries = queries.getDictionaryNames(this.session);

    // Create the directory on disk so it appears in the file explorer
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (sessionRoot) {
      const dictIndex = this.state.dictionaries.length; // new dict is last
      const dictLabel = `${dictIndex}. ${name}`;
      fs.mkdirSync(path.join(sessionRoot, dictLabel), { recursive: true });
    }

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
  }

  private handleMoveDictUp(): void {
    const idx = this.state.selectedDictIndex;
    if (!idx || idx <= 1) return;

    queries.moveDictionaryUp(this.session, idx);
    const dicts = this.state.dictionaries;
    [dicts[idx - 1], dicts[idx - 2]] = [dicts[idx - 2], dicts[idx - 1]];
    this.state.selectedDictIndex = idx - 1;
    this.dictEntryCache.delete(idx);
    this.dictEntryCache.delete(idx - 1);

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    this.panel.webview.postMessage({
      command: 'selectDictionaryItem',
      index: idx - 1,
    });
  }

  private handleMoveDictDown(): void {
    const idx = this.state.selectedDictIndex;
    if (!idx || idx >= this.state.dictionaries.length) return;

    queries.moveDictionaryDown(this.session, idx);
    const dicts = this.state.dictionaries;
    [dicts[idx - 1], dicts[idx]] = [dicts[idx], dicts[idx - 1]];
    this.state.selectedDictIndex = idx + 1;
    this.dictEntryCache.delete(idx);
    this.dictEntryCache.delete(idx + 1);

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    this.panel.webview.postMessage({
      command: 'selectDictionaryItem',
      index: idx + 1,
    });
  }

  private async handleRemoveDictionary(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const dictName = this.state.dictionaries[dictIndex - 1];

    const confirmed = await vscode.window.showWarningMessage(
      `Remove dictionary "${dictName}" from symbol list?`,
      { modal: true },
      'Remove',
    );
    if (confirmed !== 'Remove') return;

    queries.removeDictionary(this.session, dictIndex);

    // Delete the local directory
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (sessionRoot) {
      const dictLabel = `${dictIndex}. ${dictName}`;
      const dirPath = path.join(sessionRoot, dictLabel);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }

    // Re-fetch dictionaries — indices have shifted
    this.dictEntryCache.clear();
    this.envCache.clear();
    this.hierarchyCache.clear();
    this.state.dictionaries = queries.getDictionaryNames(this.session);
    this.state.selectedDictIndex = null;
    this.state.selectedCategory = null;
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    this.panel.webview.postMessage({ command: 'loadClassCategories', items: [] });
    this.panel.webview.postMessage({ command: 'loadClasses', items: [] });
    this.panel.webview.postMessage({ command: 'loadMethodCategories', items: [] });
    this.panel.webview.postMessage({ command: 'loadMethods', items: [] });
  }

  private async handleNewClassCategory(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) {
      vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'New class category name',
      placeHolder: 'e.g. Model',
    });
    if (!name) return;

    if (!this.state.classCategories.includes(name)) {
      // Insert sorted, keeping "** ALL CLASSES **" at front
      const rest = this.state.classCategories.slice(1);
      rest.push(name);
      rest.sort();
      this.state.classCategories = ['** ALL CLASSES **', ...rest];
    }
    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
    });
    this.handleSelectCategory(name);
  }

  private handleNewClass(): void {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) {
      vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }

    const dictName = this.state.dictionaries[dictIndex - 1];
    const category = (this.state.selectedCategory && this.state.selectedCategory !== '** ALL CLASSES **')
      ? this.state.selectedCategory : undefined;
    const categoryQuery = category ? `?category=${encodeURIComponent(category)}` : '';
    const uri = vscode.Uri.parse(
      `gemstone://${this.session.id}/${encodeURIComponent(dictName)}/new-class${categoryQuery}`,
    );
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }

  private async handleDeleteClass(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete class "${className}" from dictionary?`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;

    queries.deleteClass(this.session, dictIndex, className);
    this.dictEntryCache.delete(dictIndex);
    this.envCache.clear();
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    const entries = this.getCachedDictEntries(dictIndex);
    const category = this.state.selectedCategory;
    let classes: string[];
    if (!category || category === '** ALL CLASSES **') {
      classes = entries.filter(e => e.isClass).map(e => e.name);
    } else {
      classes = entries
        .filter(e => e.isClass && (e.category || '') === category)
        .map(e => e.name);
    }
    this.state.classes = classes.sort();

    this.panel.webview.postMessage({ command: 'loadClasses', items: this.state.classes });
    this.panel.webview.postMessage({ command: 'loadMethodCategories', items: [] });
    this.panel.webview.postMessage({ command: 'loadMethods', items: [] });
  }

  private async handleMoveClass(): Promise<void> {
    const srcIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!srcIndex || !className) return;

    const items = this.state.dictionaries
      .map((name, i) => ({ label: name, index: i + 1 }))
      .filter(item => item.index !== srcIndex);

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Move ${className} to which dictionary?`,
    });
    if (!picked) return;

    queries.moveClass(this.session, srcIndex, picked.index, className);
    this.dictEntryCache.delete(srcIndex);
    this.dictEntryCache.delete(picked.index);
    this.envCache.clear();
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    this.handleSelectCategory(this.state.selectedCategory || '** ALL CLASSES **');
    vscode.window.showInformationMessage(`Moved ${className} to ${picked.label}.`);
  }

  private handleRunTests(): void {
    const className = this.state.selectedClass;
    if (!className) return;
    vscode.commands.executeCommand('gemstone.runSunitClass', { className });
  }

  private handleInspectGlobal(): void {
    const className = this.state.selectedClass;
    if (!className) return;
    vscode.commands.executeCommand('gemstone.inspectGlobal', { className });
  }

  private handleNewMethod(): void {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) {
      vscode.window.showWarningMessage('Select a class first.');
      return;
    }

    const dictName = this.state.dictionaries[dictIndex - 1];
    const side = this.state.isMeta ? 'class' : 'instance';
    const category = (this.state.selectedMethodCategory && this.state.selectedMethodCategory !== '** ALL METHODS **')
      ? this.state.selectedMethodCategory : 'as yet unclassified';
    const uri = vscode.Uri.parse(
      `gemstone://${this.session.id}` +
      `/${encodeURIComponent(dictName)}` +
      `/${encodeURIComponent(className)}` +
      `/${side}` +
      `/${encodeURIComponent(category)}` +
      `/new-method`,
    );
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }

  private async handleRenameCategory(): Promise<void> {
    const className = this.state.selectedClass;
    const oldCategory = this.state.selectedMethodCategory;
    if (!className || !oldCategory || oldCategory === '** ALL METHODS **') return;

    const newName = await vscode.window.showInputBox({
      prompt: `Rename category "${oldCategory}" to:`,
      value: oldCategory,
    });
    if (!newName || newName === oldCategory) return;

    queries.renameCategory(this.session, className, this.state.isMeta, oldCategory, newName);
    const dictIndex = this.state.selectedDictIndex;
    if (dictIndex) {
      this.envCache.delete(`${dictIndex}/${className}`);
    }
    this.state.selectedMethodCategory = newName;
    this.loadMethodCategories();
  }

  private async handleDeleteMethod(): Promise<void> {
    const className = this.state.selectedClass;
    const selector = this.state.selectedMethod;
    if (!className || !selector) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete method #${selector} from ${className}?`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;

    queries.deleteMethod(this.session, className, this.state.isMeta, selector);
    const dictIndex = this.state.selectedDictIndex;
    if (dictIndex) {
      this.envCache.delete(`${dictIndex}/${className}`);
    }
    this.state.selectedMethod = null;
    this.clearDimming();
    this.loadMethodCategories();
    if (this.state.selectedMethodCategory) {
      this.handleSelectMethodCategory(this.state.selectedMethodCategory);
    }
  }

  private async handleMoveToCategory(): Promise<void> {
    const className = this.state.selectedClass;
    const selector = this.state.selectedMethod;
    if (!className || !selector) return;

    const categories = queries.getMethodCategories(this.session, className, this.state.isMeta);
    const picked = await vscode.window.showQuickPick(categories, {
      placeHolder: `Move #${selector} to which category?`,
    });
    if (!picked) return;

    queries.recategorizeMethod(this.session, className, this.state.isMeta, selector, picked);
    const dictIndex = this.state.selectedDictIndex;
    if (dictIndex) {
      this.envCache.delete(`${dictIndex}/${className}`);
    }
    this.loadMethodCategories();
    if (this.state.selectedMethodCategory) {
      this.handleSelectMethodCategory(this.state.selectedMethodCategory);
    }
  }

  private handleSendersOf(): void {
    const selector = this.state.selectedMethod;
    if (!selector) return;
    vscode.commands.executeCommand('gemstone.sendersOfSelector', {
      selector,
      sessionId: this.session.id,
    });
  }

  private handleImplementorsOf(): void {
    const selector = this.state.selectedMethod;
    if (!selector) return;
    vscode.commands.executeCommand('gemstone.implementorsOfSelector', {
      selector,
      sessionId: this.session.id,
    });
  }

  // ── Drag-and-drop handlers ──────────────────────

  private handleDropMethodOnCategory(selector: string, category: string): void {
    const className = this.state.selectedClass;
    if (!className) return;

    queries.recategorizeMethod(this.session, className, this.state.isMeta, selector, category);
    const dictIndex = this.state.selectedDictIndex;
    if (dictIndex) {
      this.envCache.delete(`${dictIndex}/${className}`);
    }
    this.loadMethodCategories();
    if (this.state.selectedMethodCategory) {
      this.handleSelectMethodCategory(this.state.selectedMethodCategory);
    }
  }

  private handleDropClassOnDictionary(className: string, dictName: string): void {
    const srcIndex = this.state.selectedDictIndex;
    if (!srcIndex) return;

    const destIndex = this.state.dictionaries.indexOf(dictName) + 1;
    if (destIndex < 1 || destIndex === srcIndex) return;

    queries.moveClass(this.session, srcIndex, destIndex, className);
    this.dictEntryCache.delete(srcIndex);
    this.dictEntryCache.delete(destIndex);
    this.envCache.clear();
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    this.handleSelectCategory(this.state.selectedCategory || '** ALL CLASSES **');
    vscode.window.showInformationMessage(`Moved ${className} to ${dictName}.`);
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

  private getMaxEnvironment(): number {
    return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
  }

  private getCachedEnvData(dictIndex: number, className: string): queries.EnvCategoryLine[] {
    const key = `${dictIndex}/${className}`;
    let data = this.envCache.get(key);
    if (!data) {
      data = queries.getClassEnvironments(
        this.session, dictIndex, className, this.getMaxEnvironment(),
      );
      this.envCache.set(key, data);
    }
    return data;
  }

  private loadMethodCategories(selected?: string | null): void {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const envData = this.getCachedEnvData(dictIndex, className);
    const filtered = envData.filter(
      e => e.isMeta === this.state.isMeta && e.envId === this.state.selectedEnvId,
    );

    const categories = filtered.map(e => e.category).sort();
    this.state.methodCategories = ['** ALL METHODS **', ...categories];

    this.panel.webview.postMessage({
      command: 'loadMethodCategories',
      items: this.state.methodCategories,
      ...(selected ? { selected } : {}),
    });
  }

  private sendHierarchy(className: string): void {
    let entries = this.hierarchyCache.get(className);
    if (!entries) {
      entries = queries.getClassHierarchy(this.session, className);
      this.hierarchyCache.set(className, entries);
    }
    this.state.hierarchyEntries = entries;
    this.state.hierarchyClassName = className;

    const superCount = entries.filter(e => e.kind === 'superclass').length;
    const items = entries.map((e, i) => ({
      className: e.className,
      dictName: e.dictName,
      kind: e.kind,
      indent: e.kind === 'superclass' ? i : e.kind === 'self' ? superCount : superCount + 1,
    }));

    this.panel.webview.postMessage({ command: 'setViewMode', mode: 'hierarchy' });
    this.panel.webview.postMessage({
      command: 'loadHierarchy',
      items,
      selectedClass: className,
    });
  }

  // ── File navigation + dimming ─────────────────────────────

  private async openClassFile(
    className: string,
    selector?: string,
    isMeta?: boolean,
  ): Promise<void> {
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (!sessionRoot) return;

    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const dictName = this.state.dictionaries[dictIndex - 1];
    const dictLabel = `${dictIndex}. ${dictName}`;
    const filePath = path.join(sessionRoot, dictLabel, `${className}.gs`);

    if (!fs.existsSync(filePath)) return;

    const uri = vscode.Uri.file(filePath);

    // Reuse the editor group where a browser file is already shown,
    // so the user can drag it to the bottom and subsequent opens stay there.
    const viewColumn = await this.getBrowserViewColumn();

    // Suppress cursor sync while we programmatically open/scroll the editor
    this.syncingFromBrowser = true;

    if (!selector) {
      // Open at top (class definition)
      this.clearDimming();
      vscode.window.showTextDocument(uri, {
        viewColumn,
        preview: false,
      }).then(() => {
        this.syncingFromBrowser = false;
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

    if (!matchingRegion) {
      this.syncingFromBrowser = false;
      return;
    }

    vscode.window.showTextDocument(uri, {
      viewColumn,
      preview: false,
      selection: new vscode.Range(
        matchingRegion.startLine, 0,
        matchingRegion.startLine, 0,
      ),
    }).then(editor => {
      const revealLine = Math.max(0, matchingRegion.startLine - 2);
      editor.revealRange(
        new vscode.Range(revealLine, 0, revealLine, 0),
        vscode.TextEditorRevealType.AtTop,
      );
      this.applyDimming(editor, matchingRegion.startLine, matchingRegion.endLine);
      this.syncingFromBrowser = false;
    });
  }

  private async getBrowserViewColumn(): Promise<vscode.ViewColumn> {
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (sessionRoot) {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.fsPath.startsWith(sessionRoot)) {
          return editor.viewColumn ?? vscode.ViewColumn.Beside;
        }
      }
    }
    // No existing editor group — create a top/bottom split so the
    // text editor opens below the browser instead of to the right.
    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1,  // vertical (top/bottom)
      groups: [
        { size: 0.5 },
        { size: 0.5 },
      ],
    });
    return vscode.ViewColumn.Two;
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
      padding: 4px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .toolbar-cell {
      flex: 1;
      padding: 0 8px;
    }

    .toolbar-mode {
      flex: 2;
      text-align: center;
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

    .toolbar button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .toolbar .session-label {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    .toolbar-session {
      text-align: right;
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

    .mode-toggle {
      display: inline-flex;
      border-radius: 3px;
      overflow: hidden;
      border: 1px solid var(--vscode-panel-border);
    }

    .mode-btn {
      padding: 2px 8px !important;
      border-radius: 0 !important;
      border: none !important;
      background: transparent !important;
      color: var(--vscode-descriptionForeground) !important;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .mode-btn:hover {
      background: var(--vscode-list-hoverBackground) !important;
    }

    .mode-btn.active {
      background: var(--vscode-button-secondaryBackground) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .hidden { display: none !important; }

    .hierarchy-item-text {
      white-space: pre;
    }

    .hierarchy-dict {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      margin-left: 8px;
    }

    .hierarchy-self-marker {
      color: var(--vscode-focusBorder);
    }

    .context-menu {
      position: fixed;
      z-index: 1000;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 4px 0;
      min-width: 160px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      display: none;
    }

    .ctx-item {
      padding: 4px 12px;
      cursor: pointer;
      white-space: nowrap;
      font-size: var(--vscode-font-size);
    }

    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }

    .ctx-separator {
      height: 1px;
      margin: 4px 0;
      background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border));
    }

    .column-list .item.drag-over {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
      background-color: var(--vscode-list-hoverBackground);
    }

    .column-list .item[draggable="true"] {
      cursor: grab;
    }

    .column-list .item.dragging {
      opacity: 0.4;
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
    <div class="toolbar-cell">
      <button id="refreshBtn" title="Refresh">&#x21bb; Refresh</button>
    </div>
    <div class="toolbar-cell toolbar-mode">
      <span class="mode-toggle">
        <button id="catBtn" class="mode-btn active" title="Category view">Category</button>
        <button id="hierBtn" class="mode-btn" title="Hierarchy view">Hierarchy</button>
      </span>
    </div>
    <div class="toolbar-cell"></div>
    <div class="toolbar-cell"></div>
    <div class="toolbar-cell toolbar-session"><span class="session-label" id="sessionLabel"></span></div>
  </div>
  <div class="columns">
    <div class="column">
      <div class="column-header">Dictionaries</div>
      <div class="column-list" id="list-dicts"></div>
    </div>
    <div class="column" id="col-categories">
      <div class="column-header">Class Categories</div>
      <div class="column-list" id="list-categories"></div>
    </div>
    <div class="column" id="col-classes">
      <div class="column-header">Classes</div>
      <div class="column-list" id="list-classes"></div>
      <div class="column-footer">
        <label><input type="radio" name="side" value="instance" checked> Instance</label>
        <label><input type="radio" name="side" value="class"> Class</label>
      </div>
    </div>
    <div class="column hidden" id="col-hierarchy" style="flex:2">
      <div class="column-header">Hierarchy</div>
      <div class="column-list" id="list-hierarchy"></div>
      <div class="column-footer">
        <label><input type="radio" name="hier-side" value="instance" checked> Instance</label>
        <label><input type="radio" name="hier-side" value="class"> Class</label>
      </div>
    </div>
    <div class="column">
      <div class="column-header">Method Categories</div>
      <div class="column-list" id="list-method-cats"></div>
      <div class="column-footer hidden" id="envFooter"></div>
    </div>
    <div class="column">
      <div class="column-header">Methods</div>
      <div class="column-list" id="list-methods"></div>
    </div>
  </div>

  <div class="context-menu" id="contextMenu"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ── Column references ──────────────────────────
    const cols = {
      dicts:      document.getElementById('list-dicts'),
      categories: document.getElementById('list-categories'),
      classes:    document.getElementById('list-classes'),
      methodCats: document.getElementById('list-method-cats'),
      methods:    document.getElementById('list-methods'),
      hierarchy:  document.getElementById('list-hierarchy'),
    };

    const colCategories = document.getElementById('col-categories');
    const colClasses = document.getElementById('col-classes');
    const colHierarchy = document.getElementById('col-hierarchy');
    const catBtn = document.getElementById('catBtn');
    const hierBtn = document.getElementById('hierBtn');
    const errorBanner = document.getElementById('errorBanner');

    // ── Populate a column with items ───────────────
    function populateColumn(listEl, items, virtualItems, draggable) {
      listEl.innerHTML = '';
      const virtualSet = new Set(virtualItems || []);
      for (const item of items) {
        const div = document.createElement('div');
        div.className = 'item' + (virtualSet.has(item) ? ' virtual' : '');
        div.textContent = item;
        div.dataset.value = item;
        if (draggable && !virtualSet.has(item)) {
          div.draggable = true;
        }
        listEl.appendChild(div);
      }
    }

    function selectItemInColumn(listEl, value) {
      if (!value) return;
      for (const child of listEl.children) {
        if (child.dataset.value === value) {
          child.classList.add('selected');
          child.scrollIntoView({ block: 'nearest' });
          break;
        }
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

    // ── Category / Hierarchy toggle ─────────────────
    catBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'toggleViewMode', mode: 'category' });
    });
    hierBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'toggleViewMode', mode: 'hierarchy' });
    });

    // ── Hierarchy column click ──────────────────────
    cols.hierarchy.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      const prev = cols.hierarchy.querySelector('.item.selected');
      if (prev) prev.classList.remove('selected');
      item.classList.add('selected');
      vscode.postMessage({ command: 'selectHierarchyClass', className: item.dataset.className });
    });

    // ── Hierarchy Instance/Class toggle ─────────────
    document.querySelectorAll('input[name="hier-side"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        // Sync the category-mode radios to match
        document.querySelectorAll('input[name="side"]').forEach((r) => {
          r.checked = (r.value === e.target.value);
        });
        vscode.postMessage({
          command: 'toggleSide',
          isMeta: e.target.value === 'class',
        });
      });
    });

    // Sync hierarchy radios when category radios change
    document.querySelectorAll('input[name="side"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        document.querySelectorAll('input[name="hier-side"]').forEach((r) => {
          r.checked = (r.value === e.target.value);
        });
      });
    });

    // ── Drag-and-drop ───────────────────────────────
    let dragSource = null;  // { type: 'method'|'class', value: string }

    function setupDragSource(listEl, type) {
      listEl.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.item');
        if (!item || !item.draggable) return;
        dragSource = { type, value: item.dataset.value };
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.value);
      });
      listEl.addEventListener('dragend', (e) => {
        const item = e.target.closest('.item');
        if (item) item.classList.remove('dragging');
        dragSource = null;
      });
    }

    function setupDropTarget(listEl, acceptType, onDrop) {
      listEl.addEventListener('dragover', (e) => {
        if (!dragSource || dragSource.type !== acceptType) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const item = e.target.closest('.item');
        // Clear previous drag-over highlights
        listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (item) item.classList.add('drag-over');
      });
      listEl.addEventListener('dragleave', (e) => {
        const item = e.target.closest('.item');
        if (item) item.classList.remove('drag-over');
      });
      listEl.addEventListener('drop', (e) => {
        e.preventDefault();
        listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (!dragSource || dragSource.type !== acceptType) return;
        const item = e.target.closest('.item');
        if (!item) return;
        onDrop(dragSource.value, item.dataset.value);
        dragSource = null;
      });
    }

    // Methods can be dragged onto method categories
    setupDragSource(cols.methods, 'method');
    setupDropTarget(cols.methodCats, 'method', (selector, category) => {
      if (category === '** ALL METHODS **') return;
      vscode.postMessage({ command: 'dropMethodOnCategory', selector, category });
    });

    // Classes can be dragged onto dictionaries
    setupDragSource(cols.classes, 'class');
    setupDropTarget(cols.dicts, 'class', (className, dictName) => {
      vscode.postMessage({ command: 'dropClassOnDictionary', className, dictName });
    });

    // ── Context menu ────────────────────────────────
    const contextMenu = document.getElementById('contextMenu');

    function showContextMenu(x, y, items) {
      contextMenu.innerHTML = '';
      for (const item of items) {
        if (item.separator) {
          const sep = document.createElement('div');
          sep.className = 'ctx-separator';
          contextMenu.appendChild(sep);
        } else {
          const div = document.createElement('div');
          div.className = 'ctx-item';
          div.textContent = item.label;
          div.addEventListener('click', () => {
            hideContextMenu();
            item.action();
          });
          contextMenu.appendChild(div);
        }
      }
      contextMenu.style.display = 'block';
      const rect = contextMenu.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      contextMenu.style.left = Math.min(x, Math.max(0, maxX)) + 'px';
      contextMenu.style.top = Math.min(y, Math.max(0, maxY)) + 'px';
    }

    function hideContextMenu() {
      contextMenu.style.display = 'none';
    }

    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) hideContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideContextMenu();
    });

    cols.dicts.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item) {
        const prev = cols.dicts.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        const idx = Array.from(cols.dicts.children).indexOf(item) + 1;
        vscode.postMessage({ command: 'selectDictionary', index: idx });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Add Dictionary\\u2026', action: () => vscode.postMessage({ command: 'ctxAddDictionary' }) },
        ...(item ? [
          { separator: true },
          { label: 'Move Up', action: () => vscode.postMessage({ command: 'ctxMoveDictUp' }) },
          { label: 'Move Down', action: () => vscode.postMessage({ command: 'ctxMoveDictDown' }) },
          { separator: true },
          { label: 'Remove Dictionary\\u2026', action: () => vscode.postMessage({ command: 'ctxRemoveDictionary' }) },
        ] : []),
      ]);
    });

    cols.categories.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Class Category\\u2026', action: () => vscode.postMessage({ command: 'ctxNewClassCategory' }) },
      ]);
    });

    cols.classes.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item) {
        const prev = cols.classes.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        vscode.postMessage({ command: 'selectClass', name: item.dataset.value });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Class\\u2026', action: () => vscode.postMessage({ command: 'ctxNewClass' }) },
        ...(item ? [
          { separator: true },
          { label: 'Delete Class', action: () => vscode.postMessage({ command: 'ctxDeleteClass' }) },
          { label: 'Move to Dictionary\\u2026', action: () => vscode.postMessage({ command: 'ctxMoveClass' }) },
          { separator: true },
          { label: 'Run SUnit Tests', action: () => vscode.postMessage({ command: 'ctxRunTests' }) },
          { label: 'Inspect Global', action: () => vscode.postMessage({ command: 'ctxInspectGlobal' }) },
        ] : []),
      ]);
    });

    cols.methodCats.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item && !item.classList.contains('virtual')) {
        const prev = cols.methodCats.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        vscode.postMessage({ command: 'selectMethodCategory', name: item.dataset.value });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Method', action: () => vscode.postMessage({ command: 'ctxNewMethod' }) },
        ...((item && !item.classList.contains('virtual')) ? [
          { separator: true },
          { label: 'Rename Category\\u2026', action: () => vscode.postMessage({ command: 'ctxRenameCategory' }) },
        ] : []),
      ]);
    });

    cols.methods.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item) {
        const prev = cols.methods.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        vscode.postMessage({ command: 'selectMethod', selector: item.dataset.value });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Method', action: () => vscode.postMessage({ command: 'ctxNewMethod' }) },
        ...(item ? [
          { separator: true },
          { label: 'Delete Method', action: () => vscode.postMessage({ command: 'ctxDeleteMethod' }) },
          { label: 'Move to Category\\u2026', action: () => vscode.postMessage({ command: 'ctxMoveToCategory' }) },
          { separator: true },
          { label: 'Senders Of', action: () => vscode.postMessage({ command: 'ctxSendersOf' }) },
          { label: 'Implementors Of', action: () => vscode.postMessage({ command: 'ctxImplementorsOf' }) },
        ] : []),
      ]);
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
          populateColumn(cols.categories, msg.items, ['** ALL CLASSES **', '** GLOBALS **']);
          if (msg.selected) selectItemInColumn(cols.categories, msg.selected);
          break;
        case 'loadClasses':
          clearFrom('classes');
          populateColumn(cols.classes, msg.items, [], true);
          if (msg.selected) selectItemInColumn(cols.classes, msg.selected);
          break;
        case 'loadMethodCategories':
          clearFrom('methodCats');
          populateColumn(cols.methodCats, msg.items, ['** ALL METHODS **']);
          if (msg.selected) selectItemInColumn(cols.methodCats, msg.selected);
          break;
        case 'loadMethods':
          cols.methods.innerHTML = '';
          populateColumn(cols.methods, msg.items, [], true);
          if (msg.selected) selectItemInColumn(cols.methods, msg.selected);
          break;
        case 'setViewMode':
          if (msg.mode === 'hierarchy') {
            colCategories.classList.add('hidden');
            colClasses.classList.add('hidden');
            colHierarchy.classList.remove('hidden');
            catBtn.classList.remove('active');
            hierBtn.classList.add('active');
          } else {
            colCategories.classList.remove('hidden');
            colClasses.classList.remove('hidden');
            colHierarchy.classList.add('hidden');
            catBtn.classList.add('active');
            hierBtn.classList.remove('active');
          }
          break;
        case 'loadHierarchy': {
          cols.hierarchy.innerHTML = '';
          for (const entry of msg.items) {
            const div = document.createElement('div');
            div.className = 'item';
            div.dataset.className = entry.className;
            const indent = '\\u00a0\\u00a0'.repeat(entry.indent);
            let text = indent + entry.className;
            if (entry.kind === 'self') text += ' \\u25c0';
            div.innerHTML = '<span class="hierarchy-item-text">' + text + '</span>'
              + '<span class="hierarchy-dict">' + entry.dictName + '</span>';
            if (entry.className === msg.selectedClass) {
              div.classList.add('selected');
            }
            cols.hierarchy.appendChild(div);
          }
          break;
        }
        case 'selectDictionaryItem': {
          const children = cols.dicts.children;
          for (let i = 0; i < children.length; i++) {
            children[i].classList.toggle('selected', i === msg.index - 1);
          }
          break;
        }
        case 'showError':
          errorBanner.textContent = msg.message;
          errorBanner.style.display = 'block';
          setTimeout(() => { errorBanner.style.display = 'none'; }, 5000);
          break;
        case 'setMaxEnvironment': {
          const footer = document.getElementById('envFooter');
          footer.innerHTML = '';
          for (let i = 0; i <= msg.maxEnv; i++) {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'env';
            radio.value = String(i);
            if (i === 0) radio.checked = true;
            radio.addEventListener('change', () => {
              vscode.postMessage({ command: 'toggleEnvironment', envId: i });
            });
            label.appendChild(radio);
            label.appendChild(document.createTextNode(' Env ' + i));
            footer.appendChild(label);
          }
          footer.classList.remove('hidden');
          break;
        }
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
