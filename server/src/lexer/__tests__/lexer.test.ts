import { describe, it, expect } from 'vitest';
import { Lexer } from '../lexer';
import { TokenType } from '../tokens';

function tokenTypes(source: string): TokenType[] {
  const lexer = new Lexer(source);
  return lexer.tokenize()
    .filter((t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EOF)
    .map((t) => t.type);
}

function tokenTexts(source: string): string[] {
  const lexer = new Lexer(source);
  return lexer.tokenize()
    .filter((t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EOF)
    .map((t) => t.text);
}

describe('Lexer', () => {
  describe('identifiers', () => {
    it('scans simple identifiers', () => {
      expect(tokenTypes('foo')).toEqual([TokenType.Identifier]);
      expect(tokenTexts('foo')).toEqual(['foo']);
    });

    it('scans identifiers with digits', () => {
      expect(tokenTexts('foo123')).toEqual(['foo123']);
    });

    it('scans single-letter identifiers', () => {
      expect(tokenTexts('x')).toEqual(['x']);
    });

    it('scans underscore-prefixed identifiers', () => {
      expect(tokenTexts('_foo')).toEqual(['_foo']);
    });
  });

  describe('keywords', () => {
    it('scans keyword tokens', () => {
      expect(tokenTypes('at:')).toEqual([TokenType.Keyword]);
      expect(tokenTexts('at:')).toEqual(['at:']);
    });

    it('does not confuse keyword with assignment', () => {
      const types = tokenTypes('x :=');
      expect(types).toEqual([TokenType.Identifier, TokenType.Assign]);
    });
  });

  describe('numbers', () => {
    it('scans integers', () => {
      expect(tokenTypes('42')).toEqual([TokenType.Integer]);
      expect(tokenTexts('42')).toEqual(['42']);
    });

    it('scans floats', () => {
      expect(tokenTypes('3.14')).toEqual([TokenType.Float]);
      expect(tokenTexts('3.14')).toEqual(['3.14']);
    });

    it('scans radixed literals with r', () => {
      expect(tokenTypes('16rFF')).toEqual([TokenType.Integer]);
      expect(tokenTexts('16rFF')).toEqual(['16rFF']);
    });

    it('scans radixed literals with #', () => {
      expect(tokenTypes('16#FF')).toEqual([TokenType.Integer]);
    });

    it('scans floats with exponent', () => {
      expect(tokenTypes('1.5e10')).toEqual([TokenType.Float]);
    });

    it('scans scaled decimals', () => {
      expect(tokenTypes('1.5s2')).toEqual([TokenType.ScaledDecimal]);
    });
  });

  describe('strings', () => {
    it('scans simple strings', () => {
      expect(tokenTypes("'hello'")).toEqual([TokenType.String]);
      expect(tokenTexts("'hello'")).toEqual(["'hello'"]);
    });

    it('scans strings with escaped quotes', () => {
      expect(tokenTexts("'it''s'")).toEqual(["'it''s'"]);
    });
  });

  describe('symbols', () => {
    it('scans identifier symbols', () => {
      expect(tokenTypes('#foo')).toEqual([TokenType.Symbol]);
      expect(tokenTexts('#foo')).toEqual(['#foo']);
    });

    it('scans keyword symbols', () => {
      expect(tokenTexts('#at:put:')).toEqual(['#at:put:']);
    });

    it('scans string symbols', () => {
      expect(tokenTypes("#'hello'")).toEqual([TokenType.Symbol]);
    });

    it('scans binary selector symbols', () => {
      expect(tokenTexts('#+')).toEqual(['#+']);
    });
  });

  describe('character literals', () => {
    it('scans character literals', () => {
      expect(tokenTypes('$A')).toEqual([TokenType.Character]);
      expect(tokenTexts('$A')).toEqual(['$A']);
    });
  });

  describe('special literals', () => {
    it('scans true', () => {
      expect(tokenTypes('true')).toEqual([TokenType.SpecialLiteral]);
    });

    it('scans false', () => {
      expect(tokenTypes('false')).toEqual([TokenType.SpecialLiteral]);
    });

    it('scans nil', () => {
      expect(tokenTypes('nil')).toEqual([TokenType.SpecialLiteral]);
    });

    it('scans _remoteNil', () => {
      expect(tokenTypes('_remoteNil')).toEqual([TokenType.SpecialLiteral]);
    });
  });

  describe('comments', () => {
    it('scans comments in double quotes', () => {
      expect(tokenTypes('"this is a comment"')).toEqual([TokenType.Comment]);
    });
  });

  describe('delimiters and punctuation', () => {
    it('scans parentheses', () => {
      expect(tokenTypes('()')).toEqual([TokenType.LeftParen, TokenType.RightParen]);
    });

    it('scans brackets', () => {
      expect(tokenTypes('[]')).toEqual([TokenType.LeftBracket, TokenType.RightBracket]);
    });

    it('scans braces', () => {
      expect(tokenTypes('{}')).toEqual([TokenType.LeftBrace, TokenType.RightBrace]);
    });

    it('scans period', () => {
      expect(tokenTypes('.')).toEqual([TokenType.Period]);
    });

    it('scans semicolon', () => {
      expect(tokenTypes(';')).toEqual([TokenType.Semicolon]);
    });

    it('scans caret', () => {
      expect(tokenTypes('^')).toEqual([TokenType.Caret]);
    });

    it('scans assignment', () => {
      expect(tokenTypes(':=')).toEqual([TokenType.Assign]);
    });

    it('scans pipe', () => {
      expect(tokenTypes('|')).toEqual([TokenType.Pipe]);
    });

    it('scans hash paren', () => {
      expect(tokenTypes('#(')).toEqual([TokenType.HashLeftParen]);
    });

    it('scans hash bracket', () => {
      expect(tokenTypes('#[')).toEqual([TokenType.HashLeftBracket]);
    });
  });

  describe('binary selectors', () => {
    it('scans single-char selectors', () => {
      expect(tokenTypes('+')).toEqual([TokenType.BinarySelector]);
    });

    it('scans two-char selectors', () => {
      expect(tokenTexts('~=')).toEqual(['~=']);
    });

    it('scans < and > as special tokens', () => {
      expect(tokenTypes('<')).toEqual([TokenType.LessThan]);
      expect(tokenTypes('>')).toEqual([TokenType.GreaterThan]);
    });

    it('scans <= and >=', () => {
      expect(tokenTypes('<=')).toEqual([TokenType.BinarySelector]);
      expect(tokenTypes('>=')).toEqual([TokenType.BinarySelector]);
    });

    it('scans minus', () => {
      expect(tokenTypes('-')).toEqual([TokenType.Minus]);
    });
  });

  describe('env specifier', () => {
    it('scans @env0:', () => {
      expect(tokenTypes('@env0:')).toEqual([TokenType.EnvSpecifier]);
      expect(tokenTexts('@env0:')).toEqual(['@env0:']);
    });

    it('scans @env12:', () => {
      expect(tokenTexts('@env12:')).toEqual(['@env12:']);
    });
  });

  describe('complex examples', () => {
    it('tokenizes a simple method', () => {
      const source = "foo: bar\n  | temp |\n  temp := bar + 1.\n  ^temp";
      const types = tokenTypes(source);
      expect(types).toContain(TokenType.Keyword);
      expect(types).toContain(TokenType.Identifier);
      expect(types).toContain(TokenType.Pipe);
      expect(types).toContain(TokenType.Assign);
      expect(types).toContain(TokenType.Integer);
      expect(types).toContain(TokenType.Caret);
    });

    it('tokenizes array literal', () => {
      const types = tokenTypes("#(1 'two' #three)");
      expect(types[0]).toBe(TokenType.HashLeftParen);
    });

    it('tokenizes byte array literal', () => {
      const types = tokenTypes('#[1 2 3]');
      expect(types[0]).toBe(TokenType.HashLeftBracket);
    });
  });
});
