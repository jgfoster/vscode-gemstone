import { describe, it, expect } from 'vitest';
import { DocumentManager } from '../../utils/documentManager';
import { getDocumentSymbols } from '../documentSymbols';
import { SymbolKind } from 'vscode-languageserver';

function symbols(source: string) {
  const dm = new DocumentManager();
  const doc = dm.update('test://test', 1, source);
  const pr = doc.parsedRegions[0];
  return getDocumentSymbols(pr.ast!, pr.region);
}

describe('Document Symbols', () => {
  it('uses only the selector as the method name (no class prefix)', () => {
    const result = symbols('method: GsSocketTestCase\ntest_foo\n  ^self\n%');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test_foo');
    expect(result[0].kind).toBe(SymbolKind.Method);
  });

  it('uses the selector for methods without a class name', () => {
    const result = symbols('method:\nbar\n  ^42\n%');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bar');
  });

  it('includes temporaries as children', () => {
    const result = symbols('method: Foo\nfoo\n  | x y |\n  ^x\n%');
    const children = result[0].children!;
    const temps = children.filter(c => c.kind === SymbolKind.Variable);
    expect(temps.map(t => t.name)).toEqual(['x', 'y']);
  });

  it('includes keyword arguments as children', () => {
    const result = symbols('method: Foo\nfoo: a bar: b\n  ^a\n%');
    const children = result[0].children!;
    const args = children.filter(c => c.detail === 'argument');
    expect(args.map(a => a.name)).toEqual(['a', 'b']);
  });

  it('includes binary argument as child', () => {
    const result = symbols('method: Foo\n+ other\n  ^other\n%');
    const children = result[0].children!;
    const args = children.filter(c => c.detail === 'argument');
    expect(args).toHaveLength(1);
    expect(args[0].name).toBe('other');
  });

  it('includes block symbols as children', () => {
    const result = symbols('method: Foo\nfoo\n  #(1 2 3) do: [:each | each]\n%');
    const children = result[0].children!;
    const blocks = children.filter(c => c.kind === SymbolKind.Function);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('[:each | ...]');
  });

  it('skips smalltalk-code regions (no breadcrumbs for Workspace)', () => {
    const dm = new DocumentManager();
    const doc = dm.update('test://workspace', 1, '6 * 7', 'smalltalk');
    // Replicate the server handler's filtering logic
    const allSymbols = doc.parsedRegions
      .filter(pr => pr.ast && pr.region.kind !== 'smalltalk-code')
      .flatMap(pr => getDocumentSymbols(pr.ast!, pr.region));
    expect(allSymbols).toHaveLength(0);
  });
});
