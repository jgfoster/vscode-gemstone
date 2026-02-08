import { describe, it, expect } from 'vitest';
import { Lexer } from '../../lexer/lexer';
import { Parser } from '../../parser/parser';
import { ScopeAnalyzer } from '../scopeAnalyzer';
import { createPosition } from '../../lexer/tokens';

function analyzeMethod(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const { ast } = parser.parse();
  if (!ast) throw new Error('Parse failed');
  const analyzer = new ScopeAnalyzer();
  return { root: analyzer.analyze(ast), analyzer, ast };
}

describe('ScopeAnalyzer', () => {
  it('finds method arguments', () => {
    const { root } = analyzeMethod('at: index ^index');
    expect(root.variables).toHaveLength(1);
    expect(root.variables[0].name).toBe('index');
    expect(root.variables[0].kind).toBe('argument');
  });

  it('finds temporaries', () => {
    const { root } = analyzeMethod('foo | x y | ^x');
    expect(root.variables).toHaveLength(2);
    expect(root.variables[0].kind).toBe('temporary');
  });

  it('finds block parameters', () => {
    const { root } = analyzeMethod('foo [:a | a]');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].variables).toHaveLength(1);
    expect(root.children[0].variables[0].name).toBe('a');
    expect(root.children[0].variables[0].kind).toBe('blockParameter');
  });

  it('finds block temporaries', () => {
    const { root } = analyzeMethod('foo [| temp | temp]');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].variables).toHaveLength(1);
    expect(root.children[0].variables[0].kind).toBe('blockTemporary');
  });

  it('nested blocks create nested scopes', () => {
    const { root } = analyzeMethod('foo [:a | [:b | a + b]]');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children).toHaveLength(1);
  });

  it('allVisibleVariables includes parent scope vars', () => {
    const { root, analyzer } = analyzeMethod('foo | x | [:a | a + x]');
    const blockScope = root.children[0];
    const pos = createPosition(0, 0, 20);
    const innerScope = analyzer.findScopeAt(root, pos);
    const allVars = analyzer.allVisibleVariables(root, pos);
    const names = allVars.map((v) => v.name);
    expect(names).toContain('x');
  });

  it('finds variable definition', () => {
    const { root, analyzer } = analyzeMethod('foo | x | x := 1. ^x');
    const pos = createPosition(0, 0, 18);
    const varInfo = analyzer.findVariableAt(root, 'x', pos);
    expect(varInfo).not.toBeNull();
    expect(varInfo!.kind).toBe('temporary');
  });
});
