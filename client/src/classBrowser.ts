import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

// ── Parsed class definition ────────────────────────────────

export interface ParsedClassDef {
  superclassName: string;
  superclassDictName: string;
  className: string;
  instVarNames: string[];
  classVarNames: string[];
  classInstVarNames: string[];
  poolDictionaries: string[];
  inDictName: string;
  category: string;
  options: string[];
  description: string;
  canEdit: boolean;
}

function parseArrayField(definition: string, keyword: string): string[] {
  const match = definition.match(new RegExp(`${keyword}:\\s*#\\(([^)]*)\\)`));
  if (!match || !match[1].trim()) return [];
  return [...match[1].matchAll(/'([^']*)'/g)].map(m => m[1]).filter(s => s.length > 0);
}

function parseWordField(definition: string, keyword: string): string {
  const match = definition.match(new RegExp(`${keyword}:\\s*(\\w+)`));
  return match?.[1] ?? '';
}

function parseStringField(definition: string, keyword: string): string {
  const match = definition.match(new RegExp(`${keyword}:\\s*'([^']*)'`));
  return match?.[1] ?? '';
}

export function parseClassDefinition(definition: string): Omit<ParsedClassDef, 'superclassDictName' | 'description' | 'canEdit'> {
  const headerMatch = definition.match(/^\s*(\w+)\s+subclass:\s+'([^']+)'/m);
  const superclassName = headerMatch?.[1] ?? '';
  const className = headerMatch?.[2] ?? '';

  const optMatch = definition.match(/options:\s*#\(([^)]*)\)/);
  const options: string[] = optMatch?.[1]
    ? [...optMatch[1].matchAll(/#(\w+)/g)].map(m => m[1])
    : [];

  return {
    superclassName,
    className,
    instVarNames: parseArrayField(definition, 'instVarNames'),
    classVarNames: parseArrayField(definition, 'classVars'),
    classInstVarNames: parseArrayField(definition, 'classInstVars'),
    poolDictionaries: parseArrayField(definition, 'poolDictionaries'),
    inDictName: parseWordField(definition, 'inDictionary'),
    category: parseStringField(definition, 'category'),
    options,
  };
}

export function buildClassDefinition(def: Omit<ParsedClassDef, 'description' | 'canEdit'>): string {
  const fmtArray = (items: string[]) =>
    items.length === 0 ? '#()' : `#(${items.map(v => `'${v.replace(/'/g, "''")}'`).join(' ')})`;
  const fmtOptions = (opts: string[]) =>
    opts.length === 0 ? '#()' : `#(${opts.map(o => `#${o}`).join(' ')})`;

  const categoryLine = def.category ? `\n  category: '${def.category.replace(/'/g, "''")}'` : '';
  return `${def.superclassName} subclass: '${def.className.replace(/'/g, "''")}'\n` +
    `  instVarNames: ${fmtArray(def.instVarNames)}\n` +
    `  classVars: ${fmtArray(def.classVarNames)}\n` +
    `  classInstVars: ${fmtArray(def.classInstVarNames)}\n` +
    `  poolDictionaries: ${fmtArray(def.poolDictionaries)}\n` +
    `  inDictionary: ${def.inDictName}${categoryLine}\n` +
    `  options: ${fmtOptions(def.options)}`;
}

// ── ClassBrowser panel ─────────────────────────────────────

interface ClassBrowserState {
  session: ActiveSession;
  dictionaries: string[];
  dictIndex: number;
  className: string | null;
}

export class ClassBrowser {
  private static panels = new Map<number, ClassBrowser>();

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private isReady = false;
  private pendingMessages: unknown[] = [];
  private state: ClassBrowserState;

  static async showOrUpdate(
    session: ActiveSession,
    dictionaries: string[],
    dictIndex: number,
    className: string | null,
  ): Promise<void> {
    const existing = ClassBrowser.panels.get(session.id);
    if (existing) {
      existing.state = { session, dictionaries, dictIndex, className };
      existing.panel.reveal(undefined, true);
      existing.loadContent();
      return;
    }

    // Open in ViewColumn.Two alongside the Globals panel
    const panel = vscode.window.createWebviewPanel(
      'gemstoneClassBrowser',
      'Class Definition',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    const browser = new ClassBrowser(panel, { session, dictionaries, dictIndex, className });
    ClassBrowser.panels.set(session.id, browser);
  }

  static disposeForSession(sessionId: number): void {
    const browser = ClassBrowser.panels.get(sessionId);
    if (browser) browser.panel.dispose();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    state: ClassBrowserState,
  ) {
    this.panel = panel;
    this.state = state;

    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  private handleMessage(message: { command: string; [key: string]: unknown }): void {
    try {
      switch (message.command) {
        case 'ready':
          this.isReady = true;
          this.flushPending();
          this.loadContent();
          break;

        case 'requestSuperclassNames': {
          const dictName = message.dictName as string;
          const idx = this.state.dictionaries.indexOf(dictName) + 1;
          if (idx < 1) break;
          const names = queries.getClassNames(this.state.session, idx);
          this.post({ command: 'loadSuperclassNames', dictName, items: names,
            defaultClassName: message.defaultClassName });
          break;
        }

        case 'requestCategories': {
          const dictName = message.dictName as string;
          const idx = this.state.dictionaries.indexOf(dictName) + 1;
          if (idx < 1) break;
          const entries = queries.getDictionaryEntries(this.state.session, idx);
          const cats = [...new Set(entries.filter(e => e.isClass).map(e => e.category))].sort();
          this.post({ command: 'loadCategories', items: cats });
          break;
        }

        case 'save': {
          const def = message.definition as Omit<ParsedClassDef, 'description' | 'canEdit'>;
          const description = message.description as string;
          const source = buildClassDefinition(def);
          queries.compileClassDefinition(this.state.session, source);
          if (description.trim()) {
            queries.setClassComment(this.state.session, def.className, description);
          }
          this.post({ command: 'saveSuccess' });
          break;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.post({ command: 'showError', message: msg });
    }
  }

  private loadContent(): void {
    const { session, dictionaries, dictIndex, className } = this.state;
    this.post({ command: 'loadDictionaries', items: dictionaries });

    if (!className) {
      // New class form: default the inDictionary to the currently selected dict
      const dictName = dictionaries[dictIndex - 1] ?? '';
      this.post({ command: 'loadDefinition', definition: null, dictName, canEdit: true });
      this.panel.title = 'Class Definition';
      return;
    }

    const defStr = queries.getClassDefinition(session, className);
    const parsed = parseClassDefinition(defStr);
    const superclassDictName = queries.getSuperclassDictName(session, dictIndex, className);
    const description = (() => {
      try { return queries.getClassComment(session, className); } catch { return ''; }
    })();
    const canEdit = (() => {
      try { return queries.canClassBeWritten(session, className); } catch { return false; }
    })();

    const full: ParsedClassDef = { ...parsed, superclassDictName, description, canEdit };
    this.post({ command: 'loadDefinition', definition: full, dictName: parsed.inDictName, canEdit });
    this.panel.title = `Class Definition: ${className}`;
  }

  private post(message: unknown): void {
    if (this.isReady) {
      this.panel.webview.postMessage(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  private flushPending(): void {
    for (const msg of this.pendingMessages) {
      this.panel.webview.postMessage(msg);
    }
    this.pendingMessages = [];
  }

  private dispose(): void {
    ClassBrowser.panels.delete(this.state.session.id);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ── HTML ──────────────────────────────────────────────────

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Class</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow-y: auto;
      padding: 8px 12px 24px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    button {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 3px 10px;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.4; cursor: default; }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .error-banner {
      padding: 6px 10px;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #f88);
      border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      margin-bottom: 8px;
      display: none;
    }
    .field { margin-bottom: 10px; }
    .field label {
      display: block;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 3px;
    }
    .row { display: flex; align-items: center; gap: 6px; }
    .identity-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
      gap: 8px 12px;
      margin-bottom: 10px;
      align-items: end;
    }
    .identity-row .field { margin-bottom: 0; min-width: 0; }
    .identity-row .field select,
    .identity-row .field input[type="text"] { width: 100%; }
    .hint {
      cursor: help;
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; border-radius: 50%;
      font-size: 0.75em; font-weight: bold; line-height: 1;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-descriptionForeground);
      margin-left: 4px; vertical-align: middle;
      opacity: 0.7;
    }
    .hint:hover { opacity: 1; }
    .tip-popup {
      position: fixed;
      max-width: 320px;
      padding: 8px 12px;
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      font-size: 0.9em;
      line-height: 1.4;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .lists-row {
      display: flex;
      gap: 12px;
      margin-bottom: 10px;
    }
    .lists-row .field { flex: 1; min-width: 0; margin-bottom: 0; }
    select, input[type="text"] {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 3px 6px;
      flex: 1;
      min-width: 0;
    }
    select { cursor: pointer; }
    .list-field {
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      background: var(--vscode-input-background);
      min-height: 60px;
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 4px;
    }
    .list-field .item {
      padding: 2px 6px;
      cursor: pointer;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .list-field .item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .list-field .item:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
    .list-controls { display: flex; gap: 4px; align-items: center; }
    .list-controls input { flex: 1; }
    textarea {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      width: 100%;
      resize: vertical;
      padding: 4px 6px;
      min-height: 80px;
    }
    fieldset {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 10px;
      margin-top: 2px;
    }
    legend {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      padding: 0 4px;
    }
    .options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 4px 16px;
    }
    .options-grid label { display: flex; align-items: center; gap: 5px; font-size: 0.95em; }
    .options-grid .col-header {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
  </style>
</head>
<body>
  <div class="error-banner" id="errorBanner"></div>
  <div class="toolbar">
    <button id="saveBtn" disabled>Save</button>
  </div>

  <div class="identity-row">
    <div class="field">
      <label>Superclass Dictionary</label>
      <select id="superclassDictSelect"></select>
    </div>
    <div class="field">
      <label>Superclass</label>
      <select id="superclassSelect"></select>
    </div>
    <div class="field">
      <label>Subclass</label>
      <input type="text" id="className" placeholder="ClassName">
    </div>
    <div class="field">
      <label>In Dictionary</label>
      <select id="inDictSelect"></select>
    </div>
    <div class="field">
      <label>Category</label>
      <select id="categorySelect"></select>
      <input type="text" id="categoryInput" placeholder="new category" style="display:none">
    </div>
  </div>

  <div class="lists-row">
    <div class="field">
      <label>Instance Variables</label>
      <div class="list-field" id="instVarList"></div>
      <div class="list-controls">
        <input type="text" id="instVarInput" placeholder="name">
        <button class="secondary" onclick="listAdd('instVarList','instVarInput')">Add</button>
        <button class="secondary" onclick="listRemove('instVarList')">Remove</button>
      </div>
    </div>
    <div class="field">
      <label>Class Variables</label>
      <div class="list-field" id="classVarList"></div>
      <div class="list-controls">
        <input type="text" id="classVarInput" placeholder="name">
        <button class="secondary" onclick="listAdd('classVarList','classVarInput')">Add</button>
        <button class="secondary" onclick="listRemove('classVarList')">Remove</button>
      </div>
    </div>
    <div class="field">
      <label>Class Instance Variables</label>
      <div class="list-field" id="classInstVarList"></div>
      <div class="list-controls">
        <input type="text" id="classInstVarInput" placeholder="name">
        <button class="secondary" onclick="listAdd('classInstVarList','classInstVarInput')">Add</button>
        <button class="secondary" onclick="listRemove('classInstVarList')">Remove</button>
      </div>
    </div>
    <div class="field">
      <label>Pool Dictionaries</label>
      <div class="list-field" id="poolDictList"></div>
      <div class="list-controls">
        <select id="poolDictSelect" style="flex:1"><option value="">-- select --</option></select>
        <button class="secondary" onclick="listAddFromSelect('poolDictList','poolDictSelect')">Add</button>
        <button class="secondary" onclick="listRemove('poolDictList')">Remove</button>
      </div>
    </div>
  </div>

  <div class="field">
    <label>Options</label>
    <fieldset>
      <div class="options-grid">
        <label><input type="checkbox" name="opt" value="noInheritOptions"> Reset Inherited Options <span class="hint" data-tip="If set, none of subclassesDisallowed, disallowGciStore, traverseByCallback, dbTransient, instancesNonPersistent, instancesInvariant will be inherited from the superclass, nor copied from the current version of the class.">?</span></label>
        <label><input type="checkbox" name="opt" value="disallowGciStore"> Disallow GCI Store</label>
        <label><input type="radio" name="persist" value=""> Normal</label>
        <label><input type="checkbox" name="opt" value="subclassesDisallowed"> Subclasses Disallowed</label>
        <label><input type="checkbox" name="opt" value="modifiable"> Modifiable <span class="hint" data-tip="Prevents instance creation and allows further updates to the class schema without creating a new class history entry.">?</span></label>
        <label><input type="radio" name="persist" value="dbTransient"> DB Transient <span class="hint" data-tip="On commit, selected instance variables are set to nil.">?</span></label>
        <label><input type="checkbox" name="opt" value="traverseByCallback"> Traverse By Callback</label>
        <label><input type="checkbox" name="opt" value="selfCanBeSpecial"> Self Can Be Special</label>
        <label><input type="radio" name="persist" value="instancesNonPersistent"> Instances Non-Persistent <span class="hint" data-tip="Attempting to commit an instance of this class will signal an error.">?</span></label>
        <label><input type="checkbox" name="opt" value="logCreation"> Log Class Creation <span class="hint" data-tip="Causes logging with GsFile(C)>>gciLogServer: of class creation or equivalence.">?</span></label>
        <div></div>
        <label><input type="radio" name="persist" value="instancesInvariant"> Instances Invariant</label>
      </div>
    </fieldset>
  </div>

  <div class="field">
    <label>Description</label>
    <textarea id="description" rows="5"></textarea>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let canEdit = false;
    let dirty = false;
    let dictionaries = [];
    // Map dictName → class names (lazily loaded)
    const classNameCache = {};

    // ── Hint buttons (?) ─────────────────────────────────
    let activeTip = null;
    function dismissTip() {
      if (activeTip) { activeTip.remove(); activeTip = null; }
    }
    document.querySelectorAll('.hint[data-tip]').forEach(el => {
      el.title = el.getAttribute('data-tip');
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTip) { dismissTip(); return; }
        const popup = document.createElement('div');
        popup.className = 'tip-popup';
        popup.textContent = el.getAttribute('data-tip');
        document.body.appendChild(popup);
        const rect = el.getBoundingClientRect();
        popup.style.left = Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8) + 'px';
        popup.style.top = (rect.bottom + 4) + 'px';
        activeTip = popup;
      });
    });
    document.addEventListener('click', dismissTip);

    // ── Helpers ──────────────────────────────────────────

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function setDirty() {
      dirty = true;
      document.getElementById('saveBtn').disabled = !canEdit;
    }

    function listItems(listId) {
      return [...document.getElementById(listId).querySelectorAll('.item')].map(el => el.dataset.value);
    }

    function listAdd(listId, inputId) {
      const input = document.getElementById(inputId);
      const val = input.value.trim();
      if (!val) return;
      const existing = listItems(listId);
      if (existing.includes(val)) return;
      appendListItem(listId, val);
      input.value = '';
      setDirty();
    }

    function listAddFromSelect(listId, selectId) {
      const sel = document.getElementById(selectId);
      const val = sel.value;
      if (!val) return;
      const existing = listItems(listId);
      if (existing.includes(val)) return;
      appendListItem(listId, val);
      setDirty();
    }

    function appendListItem(listId, value) {
      const container = document.getElementById(listId);
      const div = document.createElement('div');
      div.className = 'item';
      div.dataset.value = value;
      div.textContent = value;
      div.addEventListener('click', () => {
        container.querySelectorAll('.item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
      });
      container.appendChild(div);
    }

    function listRemove(listId) {
      const container = document.getElementById(listId);
      const sel = container.querySelector('.selected');
      if (sel) { sel.remove(); setDirty(); }
    }

    function setList(listId, values) {
      const container = document.getElementById(listId);
      container.innerHTML = '';
      for (const v of values) appendListItem(listId, v);
    }

    function populateSelect(el, options, selectedValue) {
      el.innerHTML = options.map(o =>
        '<option value="' + esc(o) + '"' + (o === selectedValue ? ' selected' : '') + '>' + esc(o) + '</option>'
      ).join('');
    }

    function setFormDisabled(disabled) {
      document.querySelectorAll('input, select, textarea, button:not(#saveBtn)').forEach(el => {
        el.disabled = disabled;
      });
    }

    // ── Superclass dict / class dropdowns ────────────────

    function loadSuperclassNames(dictName, names, selectedName) {
      classNameCache[dictName] = names;
      const sel = document.getElementById('superclassSelect');
      populateSelect(sel, names, selectedName || names[0] || '');
    }

    document.getElementById('superclassDictSelect').addEventListener('change', function() {
      const dictName = this.value;
      if (classNameCache[dictName]) {
        loadSuperclassNames(dictName, classNameCache[dictName], '');
      } else {
        vscode.postMessage({ command: 'requestSuperclassNames', dictName });
      }
      setDirty();
    });

    // ── inDictionary → refresh categories ───────────────

    document.getElementById('inDictSelect').addEventListener('change', function() {
      vscode.postMessage({ command: 'requestCategories', dictName: this.value });
      setDirty();
    });

    // ── category dropdown: "+ Add new..." ───────────────

    document.getElementById('categorySelect').addEventListener('change', function() {
      const input = document.getElementById('categoryInput');
      if (this.value === '__new__') {
        input.style.display = '';
        this.style.display = 'none';
        input.focus();
      }
      setDirty();
    });

    // ── Save ─────────────────────────────────────────────

    document.getElementById('saveBtn').addEventListener('click', () => {
      const catSel = document.getElementById('categorySelect');
      const catInput = document.getElementById('categoryInput');
      const category = catSel.style.display === 'none' ? catInput.value.trim() : catSel.value === '__new__' ? '' : catSel.value;

      const persistEl = document.querySelector('input[name="persist"]:checked');
      const persist = persistEl ? persistEl.value : '';

      const opts = [...document.querySelectorAll('input[name="opt"]:checked')].map(el => el.value);
      if (persist) opts.push(persist);

      const definition = {
        superclassName: document.getElementById('superclassSelect').value,
        superclassDictName: document.getElementById('superclassDictSelect').value,
        className: document.getElementById('className').value.trim(),
        instVarNames: listItems('instVarList'),
        classVarNames: listItems('classVarList'),
        classInstVarNames: listItems('classInstVarList'),
        poolDictionaries: listItems('poolDictList'),
        inDictName: document.getElementById('inDictSelect').value,
        category,
        options: opts,
      };

      vscode.postMessage({
        command: 'save',
        definition,
        description: document.getElementById('description').value,
      });
    });

    // ── Change listeners ─────────────────────────────────

    ['className', 'description'].forEach(id => {
      document.getElementById(id).addEventListener('input', setDirty);
    });

    // ── Message handler ──────────────────────────────────

    function loadDefinition(def, defaultDictName) {
      if (def) {
        populateSelect(document.getElementById('superclassDictSelect'), dictionaries, def.superclassDictName);
        // Request superclass names for the superclass dict
        if (def.superclassDictName) {
          if (classNameCache[def.superclassDictName]) {
            loadSuperclassNames(def.superclassDictName, classNameCache[def.superclassDictName], def.superclassName);
          } else {
            // Temporarily populate with just the known superclass name
            populateSelect(document.getElementById('superclassSelect'), [def.superclassName], def.superclassName);
            vscode.postMessage({ command: 'requestSuperclassNames', dictName: def.superclassDictName });
          }
        }
        document.getElementById('className').value = def.className;
        setList('instVarList', def.instVarNames);
        setList('classVarList', def.classVarNames);
        setList('classInstVarList', def.classInstVarNames);
        setList('poolDictList', def.poolDictionaries);
        populateSelect(document.getElementById('inDictSelect'), dictionaries, def.inDictName);
        document.getElementById('description').value = def.description || '';

        // Options checkboxes
        document.querySelectorAll('input[name="opt"]').forEach(cb => {
          cb.checked = def.options.includes(cb.value);
        });
        const persistOpts = ['dbTransient', 'instancesNonPersistent', 'instancesInvariant'];
        const persistVal = def.options.find(o => persistOpts.includes(o)) || '';
        document.querySelectorAll('input[name="persist"]').forEach(rb => {
          rb.checked = rb.value === persistVal;
        });

        // Request categories for inDictionary
        vscode.postMessage({ command: 'requestCategories', dictName: def.inDictName });
      } else {
        // New class: defaults — superclass defaults to Globals>>Object, target dict to selected
        const superDict = dictionaries.includes('Globals') ? 'Globals' : (defaultDictName || dictionaries[0] || '');
        populateSelect(document.getElementById('superclassDictSelect'), dictionaries, superDict);
        vscode.postMessage({ command: 'requestSuperclassNames', dictName: superDict, defaultClassName: 'Object' });
        populateSelect(document.getElementById('inDictSelect'), dictionaries, defaultDictName || dictionaries[0] || '');
        vscode.postMessage({ command: 'requestCategories', dictName: defaultDictName || dictionaries[0] || '' });
        document.getElementById('className').value = '';
        setList('instVarList', []);
        setList('classVarList', []);
        setList('classInstVarList', []);
        setList('poolDictList', []);
        document.getElementById('description').value = '';
        document.querySelectorAll('input[name="opt"]').forEach(cb => cb.checked = false);
        document.querySelector('input[name="persist"][value=""]').checked = true;
      }

      dirty = false;
      document.getElementById('saveBtn').disabled = !canEdit || (!!def && !def.canEdit);
      setFormDisabled(!canEdit && !!def && !def.canEdit);
    }

    window.addEventListener('message', ev => {
      const msg = ev.data;
      switch (msg.command) {
        case 'loadDictionaries':
          dictionaries = msg.items;
          populateSelect(document.getElementById('poolDictSelect'),
            ['', ...msg.items], '');
          break;

        case 'loadDefinition':
          canEdit = msg.canEdit;
          loadDefinition(msg.definition, msg.dictName);
          break;

        case 'loadSuperclassNames': {
          const selName = msg.defaultClassName
            || (document.getElementById('superclassDictSelect').value === msg.dictName
              ? document.getElementById('superclassSelect').value
              : '');
          loadSuperclassNames(msg.dictName, msg.items, selName);
          break;
        }

        case 'loadCategories': {
          const catSel = document.getElementById('categorySelect');
          const currentCat = catSel.dataset.current || '';
          const opts = ['', ...msg.items, '__new__'];
          catSel.innerHTML =
            '<option value="">-- none --</option>' +
            msg.items.map(c => '<option value="' + esc(c) + '"' + (c === currentCat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
            '<option value="__new__">+ Add new\u2026</option>';
          catSel.dataset.current = currentCat;
          break;
        }

        case 'saveSuccess':
          dirty = false;
          document.getElementById('saveBtn').disabled = true;
          break;

        case 'showError': {
          const banner = document.getElementById('errorBanner');
          banner.textContent = msg.message;
          banner.style.display = 'block';
          setTimeout(() => { banner.style.display = 'none'; }, 6000);
          break;
        }
      }
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
