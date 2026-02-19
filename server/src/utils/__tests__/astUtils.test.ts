import { describe, it, expect } from 'vitest';
import { Lexer } from '../../lexer/lexer';
import { Parser } from '../../parser/parser';
import { findSelectorAtPosition } from '../astUtils';

/** Parse a method and return tokens + ast for testing. */
function parse(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const { ast } = parser.parse();
  return { tokens, ast };
}

describe('findSelectorAtPosition', () => {
  describe('unary selectors', () => {
    it('returns unary message selector', () => {
      // bar
      //   ^self size
      //   01234567890
      const { tokens, ast } = parse('bar\n  ^self size');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 8 }, 0);
      expect(result).toBe('size');
    });

    it('returns method pattern selector', () => {
      // bar
      // 012
      const { tokens, ast } = parse('bar\n  ^self');
      const result = findSelectorAtPosition(tokens, ast, { line: 0, character: 0 }, 0);
      expect(result).toBe('bar');
    });
  });

  describe('keyword selectors', () => {
    it('composes full keyword selector from at:', () => {
      // foo
      //   self at: 1 put: 2
      //   0123456789012345678
      const { tokens, ast } = parse('foo\n  self at: 1 put: 2');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 7 }, 0);
      expect(result).toBe('at:put:');
    });

    it('composes full keyword selector from put:', () => {
      const { tokens, ast } = parse('foo\n  self at: 1 put: 2');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 13 }, 0);
      expect(result).toBe('at:put:');
    });

    it('returns keyword method pattern selector', () => {
      // at: index put: value
      // 01234567890123456789
      const { tokens, ast } = parse('at: index put: value\n  ^value');
      const result = findSelectorAtPosition(tokens, ast, { line: 0, character: 0 }, 0);
      expect(result).toBe('at:put:');
    });
  });

  describe('binary selectors', () => {
    it('returns binary selector +', () => {
      //   ^1 + 2
      //   0123456
      const { tokens, ast } = parse('foo\n  ^1 + 2');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 5 }, 0);
      expect(result).toBe('+');
    });

    it('returns binary selector -', () => {
      const { tokens, ast } = parse('foo\n  ^1 - 2');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 5 }, 0);
      expect(result).toBe('-');
    });

    it('returns binary selector <', () => {
      const { tokens, ast } = parse('foo\n  ^1 < 2');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 5 }, 0);
      expect(result).toBe('<');
    });

    it('returns binary selector >', () => {
      const { tokens, ast } = parse('foo\n  ^1 > 2');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 5 }, 0);
      expect(result).toBe('>');
    });
  });

  describe('variables (should return null)', () => {
    it('returns null for method argument', () => {
      // bar: arg
      //   ^arg
      //   01234
      const { tokens, ast } = parse('bar: arg\n  ^arg');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 3 }, 0);
      expect(result).toBeNull();
    });

    it('returns null for temporary variable', () => {
      // foo | x |
      //   ^x
      //   0123
      const { tokens, ast } = parse('foo | x |\n  ^x');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 3 }, 0);
      expect(result).toBeNull();
    });

    it('returns null for instance variable in assignment', () => {
      // foo
      //   instVar := 42
      //   0123456789...
      const { tokens, ast } = parse('foo\n  instVar := 42');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 2 }, 0);
      expect(result).toBeNull();
    });
  });

  describe('non-selectors (should return null)', () => {
    it('returns null for number literal', () => {
      const { tokens, ast } = parse('foo\n  ^42');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 3 }, 0);
      expect(result).toBeNull();
    });

    it('returns null for string literal', () => {
      const { tokens, ast } = parse("foo\n  ^'hello'");
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 3 }, 0);
      expect(result).toBeNull();
    });

    it('returns null when no token at position', () => {
      const { tokens, ast } = parse('foo\n  ^self');
      const result = findSelectorAtPosition(tokens, ast, { line: 1, character: 0 }, 0);
      expect(result).toBeNull();
    });

    it('returns null when ast is null', () => {
      const { tokens } = parse('foo\n  ^self');
      const result = findSelectorAtPosition(tokens, null, { line: 1, character: 3 }, 0);
      expect(result).toBeNull();
    });
  });

  describe('with lineOffset', () => {
    it('adjusts positions for offset regions', () => {
      // Simulates a method region starting at line 5 in the document
      // The tokens have document-level positions (line 5, 6, etc.)
      // but the AST has region-local positions (line 0, 1, etc.)
      const source = 'foo\n  ^self size';
      const lexer = new Lexer(source);
      const regionTokens = lexer.tokenize();
      const parser = new Parser(regionTokens);
      const { ast } = parser.parse();

      // Offset tokens to simulate document-level coordinates
      const lineOffset = 5;
      const offsetTokens = regionTokens.map(t => ({
        ...t,
        range: {
          start: { ...t.range.start, line: t.range.start.line + lineOffset },
          end: { ...t.range.end, line: t.range.end.line + lineOffset },
        },
      }));

      // Position is in document coordinates (line 6 = "  ^self size")
      const result = findSelectorAtPosition(
        offsetTokens, ast, { line: 6, character: 8 }, lineOffset,
      );
      expect(result).toBe('size');
    });
  });
});
