import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';

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

/**
 * Opens class definitions as regular gemstone:// documents in the editor.
 * 
 * Class-definition tabs are closed automatically when the session logs out
 * via GemStoneFileSystemProvider.closeTabsForSession in the extension logout flow,
 * so no explicit cleanup is needed in disposeForSession.
 */
export class ClassBrowser {
  static async showOrUpdate(
    session: ActiveSession,
    dictionaries: string[],
    dictIndex: number,
    className: string | null,
  ): Promise<void> {
    if (!className) return;

    const dictName = dictionaries[dictIndex - 1];
    if (!dictName) return;

    const uri = vscode.Uri.parse(
      `gemstone://${session.id}/${encodeURIComponent(dictName)}/${encodeURIComponent(className)}/definition`,
    );

    // Don't re-fetch and re-open if the tab is already present anywhere
    const uriString = uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri?.toString() === uriString) return;
      }
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Two,
      preview: true,
      preserveFocus: true,
    });
  }
}
