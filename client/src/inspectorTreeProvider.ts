import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { OOP_NIL } from './gciConstants';
import * as debug from './debugQueries';

// ── Node type ──────────────────────────────────────────

export interface InspectorNode {
  sessionId: number;
  oop: bigint;
  label: string;
  isRoot: boolean;
  kind: 'root' | 'named' | 'indexed';
}

// ── TreeDataProvider ───────────────────────────────────

const MAX_INDEXED = 500;
const MAX_PRINT_STRING = 200;

export class InspectorTreeProvider implements vscode.TreeDataProvider<InspectorNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InspectorNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private roots: InspectorNode[] = [];

  constructor(private sessionManager: SessionManager) {}

  addRoot(sessionId: number, oop: bigint, label: string): void {
    this.roots.push({ sessionId, oop, label, isRoot: true, kind: 'root' });
    this._onDidChangeTreeData.fire(undefined);
  }

  removeRoot(node: InspectorNode): void {
    const idx = this.roots.indexOf(node);
    if (idx >= 0) {
      this.roots.splice(idx, 1);
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  clearAll(): void {
    this.roots = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  removeSessionItems(sessionId: number): void {
    const before = this.roots.length;
    this.roots = this.roots.filter(r => r.sessionId !== sessionId);
    if (this.roots.length !== before) {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(node: InspectorNode): vscode.TreeItem {
    const session = this.sessionManager.getSession(node.sessionId);
    if (!session) {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = '<session disconnected>';
      item.iconPath = new vscode.ThemeIcon('warning');
      item.contextValue = node.isRoot ? 'gemstoneInspectorRoot' : 'gemstoneInspectorItem';
      return item;
    }

    const value = debug.getObjectPrintString(session, node.oop, MAX_PRINT_STRING);
    const className = debug.getObjectClassName(session, node.oop);

    let collapsible = vscode.TreeItemCollapsibleState.None;
    if (node.oop !== OOP_NIL && !debug.isSpecialOop(session, node.oop)) {
      const namedCount = debug.getInstVarNames(session, node.oop).length;
      const indexedCount = debug.getIndexedSize(session, node.oop);
      if (namedCount > 0 || indexedCount > 0) {
        collapsible = vscode.TreeItemCollapsibleState.Collapsed;
      }
    }

    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = value;
    item.tooltip = `${className}: ${value}`;
    item.contextValue = node.isRoot ? 'gemstoneInspectorRoot' : 'gemstoneInspectorItem';

    switch (node.kind) {
      case 'root':
        item.iconPath = new vscode.ThemeIcon('eye');
        break;
      case 'named':
        item.iconPath = new vscode.ThemeIcon('symbol-field');
        break;
      case 'indexed':
        item.iconPath = new vscode.ThemeIcon('symbol-array');
        break;
    }

    return item;
  }

  getChildren(node?: InspectorNode): InspectorNode[] {
    if (!node) return this.roots;

    const session = this.sessionManager.getSession(node.sessionId);
    if (!session) return [];

    if (node.oop === OOP_NIL || debug.isSpecialOop(session, node.oop)) {
      return [];
    }

    const children: InspectorNode[] = [];

    // Named instance variables
    const names = debug.getInstVarNames(session, node.oop);
    if (names.length > 0) {
      const oops = debug.getNamedInstVarOops(session, node.oop, names.length);
      for (let i = 0; i < names.length && i < oops.length; i++) {
        children.push({
          sessionId: node.sessionId,
          oop: oops[i],
          label: names[i],
          isRoot: false,
          kind: 'named',
        });
      }
    }

    // Indexed elements
    const indexedCount = debug.getIndexedSize(session, node.oop);
    if (indexedCount > 0) {
      const count = Math.min(indexedCount, MAX_INDEXED);
      const oops = debug.getIndexedOops(session, node.oop, 1, count);
      for (let i = 0; i < oops.length; i++) {
        children.push({
          sessionId: node.sessionId,
          oop: oops[i],
          label: `[${i + 1}]`,
          isRoot: false,
          kind: 'indexed',
        });
      }
    }

    return children;
  }
}
