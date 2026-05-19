import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { window, workspace, Uri, ViewColumn } from '../__mocks__/vscode';
import { ClassBrowser, parseClassDefinition, buildClassDefinition } from '../classBrowser';
import type { ActiveSession } from '../sessionManager';
import type { GemStoneLogin } from '../loginTypes';

function makeSession(id = 1): ActiveSession {
  return { id, login: { label: 'test' } as GemStoneLogin } as unknown as ActiveSession;
}

// ── parseClassDefinition ──────────────────────────────────

describe('parseClassDefinition', () => {
  it('parses superclass name and class name', () => {
    const def = parseClassDefinition("Object subclass: 'MyClass'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.superclassName).toBe('Object');
    expect(def.className).toBe('MyClass');
  });

  it('parses non-empty instVarNames', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #('x' 'y')\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.instVarNames).toEqual(['x', 'y']);
  });

  it('parses empty instVarNames as empty array', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.instVarNames).toEqual([]);
  });

  it('parses classVars and classInstVars', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #('ClassVar')\n  classInstVars: #('CiVar')\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.classVarNames).toEqual(['ClassVar']);
    expect(def.classInstVarNames).toEqual(['CiVar']);
  });

  it('parses inDictionary', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: DataCurator\n  options: #()");
    expect(def.inDictName).toBe('DataCurator');
  });

  it('parses optional category', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  category: 'Kernel-Objects'\n  options: #()");
    expect(def.category).toBe('Kernel-Objects');
  });

  it('returns empty string for missing category', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.category).toBe('');
  });

  it('parses options', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #(#modifiable #subclassesDisallowed)");
    expect(def.options).toEqual(['modifiable', 'subclassesDisallowed']);
  });

  it('parses empty options as empty array', () => {
    const def = parseClassDefinition("Object subclass: 'Foo'\n  instVarNames: #()\n  classVars: #()\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #()");
    expect(def.options).toEqual([]);
  });
});

// ── buildClassDefinition ─────────────────────────────────

describe('buildClassDefinition', () => {
  it('builds a minimal class definition', () => {
    const src = buildClassDefinition({
      superclassName: 'Object',
      superclassDictName: 'UserGlobals',
      className: 'MyClass',
      instVarNames: [],
      classVarNames: [],
      classInstVarNames: [],
      poolDictionaries: [],
      inDictName: 'UserGlobals',
      category: '',
      options: [],
    });
    expect(src).toContain("Object subclass: 'MyClass'");
    expect(src).toContain('instVarNames: #()');
    expect(src).toContain('inDictionary: UserGlobals');
    expect(src).toContain('options: #()');
    expect(src).not.toContain('category:');
  });

  it('includes non-empty instVarNames', () => {
    const src = buildClassDefinition({
      superclassName: 'Object', superclassDictName: '', className: 'Foo',
      instVarNames: ['x', 'y'], classVarNames: [], classInstVarNames: [],
      poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: [],
    });
    expect(src).toContain("instVarNames: #('x' 'y')");
  });

  it('includes category when present', () => {
    const src = buildClassDefinition({
      superclassName: 'Object', superclassDictName: '', className: 'Foo',
      instVarNames: [], classVarNames: [], classInstVarNames: [],
      poolDictionaries: [], inDictName: 'UserGlobals', category: 'My-Cat', options: [],
    });
    expect(src).toContain("category: 'My-Cat'");
  });

  it('includes options as symbols', () => {
    const src = buildClassDefinition({
      superclassName: 'Object', superclassDictName: '', className: 'Foo',
      instVarNames: [], classVarNames: [], classInstVarNames: [],
      poolDictionaries: [], inDictName: 'UserGlobals', category: '', options: ['modifiable'],
    });
    expect(src).toContain('options: #(#modifiable)');
  });

  it('round-trips through parse then build', () => {
    const original = "Object subclass: 'MyClass'\n  instVarNames: #('x' 'y')\n  classVars: #('CV')\n  classInstVars: #()\n  poolDictionaries: #()\n  inDictionary: UserGlobals\n  options: #(#modifiable)";
    const parsed = parseClassDefinition(original);
    const rebuilt = buildClassDefinition({ ...parsed, superclassDictName: 'UserGlobals' });
    // Parse again to compare fields
    const reparsed = parseClassDefinition(rebuilt);
    expect(reparsed.className).toBe('MyClass');
    expect(reparsed.instVarNames).toEqual(['x', 'y']);
    expect(reparsed.classVarNames).toEqual(['CV']);
    expect(reparsed.options).toEqual(['modifiable']);
  });
});

// ── ClassBrowser panel lifecycle ─────────────────────────

describe('ClassBrowser', () => {
  let session: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();
  });

  it('does not open the class definition editor when the class name is null', async () => {
    await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, null);
    
    expect(workspace.openTextDocument).not.toHaveBeenCalled();
    expect(window.showTextDocument).not.toHaveBeenCalled();
  });

  it('opens the class definition editor when the class name is not null', async () => {
    await ClassBrowser.showOrUpdate(session, ['UserGlobals'], 1, 'Array');

    expect(workspace.openTextDocument).toHaveBeenCalledWith(
      Uri.parse('gemstone://1/UserGlobals/Array/definition'),
    );
    expect(window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: Uri.parse('gemstone://1/UserGlobals/Array/definition') }),
      expect.objectContaining({
        viewColumn: ViewColumn.Two,
        preview: true,
        preserveFocus: true,
      }),
    );
  });
});
