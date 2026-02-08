import { describe, it, expect } from 'vitest';
import { Lexer } from '../../lexer/lexer';
import { Parser } from '../parser';

function parse(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

describe('Parser', () => {
  describe('method patterns', () => {
    it('parses unary method', () => {
      const { ast } = parse('foo ^self');
      expect(ast).not.toBeNull();
      expect(ast!.pattern.kind).toBe('UnaryPattern');
      expect(ast!.pattern.selector).toBe('foo');
    });

    it('parses binary method', () => {
      const { ast } = parse('+ other ^self');
      expect(ast).not.toBeNull();
      expect(ast!.pattern.kind).toBe('BinaryPattern');
      expect(ast!.pattern.selector).toBe('+');
    });

    it('parses keyword method', () => {
      const { ast } = parse('at: index put: value ^self');
      expect(ast).not.toBeNull();
      expect(ast!.pattern.kind).toBe('KeywordPattern');
      if (ast!.pattern.kind === 'KeywordPattern') {
        expect(ast!.pattern.selector).toBe('at:put:');
        expect(ast!.pattern.parameters).toHaveLength(2);
      }
    });
  });

  describe('statements', () => {
    it('parses return statement', () => {
      const { ast } = parse('foo ^42');
      expect(ast).not.toBeNull();
      expect(ast!.body.statements).toHaveLength(1);
      expect(ast!.body.statements[0].kind).toBe('Return');
    });

    it('parses assignment', () => {
      const { ast } = parse('foo x := 5');
      expect(ast).not.toBeNull();
      expect(ast!.body.statements).toHaveLength(1);
      expect(ast!.body.statements[0].kind).toBe('Assignment');
    });

    it('parses multiple statements', () => {
      const { ast } = parse('foo x := 1. y := 2. ^x');
      expect(ast).not.toBeNull();
      expect(ast!.body.statements).toHaveLength(3);
    });
  });

  describe('temporaries', () => {
    it('parses temporaries', () => {
      const { ast } = parse('foo | x y z | ^x');
      expect(ast).not.toBeNull();
      expect(ast!.body.temporaries).toHaveLength(3);
      expect(ast!.body.temporaries[0].name).toBe('x');
    });
  });

  describe('expressions', () => {
    it('parses unary message', () => {
      const { ast } = parse('foo ^self size');
      expect(ast).not.toBeNull();
      const ret = ast!.body.statements[0];
      expect(ret.kind).toBe('Return');
    });

    it('parses keyword message', () => {
      const { ast } = parse('foo ^self at: 1');
      expect(ast).not.toBeNull();
    });

    it('parses cascade', () => {
      const { ast } = parse('foo self add: 1; add: 2; yourself');
      expect(ast).not.toBeNull();
      const expr = ast!.body.statements[0];
      if (expr.kind === 'Expression') {
        expect(expr.cascades.length).toBeGreaterThan(0);
      }
    });
  });

  describe('blocks', () => {
    it('parses empty block', () => {
      const { ast } = parse('foo ^[]');
      expect(ast).not.toBeNull();
    });

    it('parses block with parameters', () => {
      const { ast } = parse('foo ^[:a :b | a + b]');
      expect(ast).not.toBeNull();
    });

    it('parses block with temporaries', () => {
      const { ast } = parse('foo ^[| temp | temp := 1. temp]');
      expect(ast).not.toBeNull();
    });
  });

  describe('literals', () => {
    it('parses string literal', () => {
      const { ast } = parse("foo ^'hello'");
      expect(ast).not.toBeNull();
    });

    it('parses symbol literal', () => {
      const { ast } = parse('foo ^#bar');
      expect(ast).not.toBeNull();
    });

    it('parses array literal', () => {
      const { ast } = parse("foo ^#(1 'two' #three)");
      expect(ast).not.toBeNull();
    });

    it('parses byte array literal', () => {
      const { ast } = parse('foo ^#[1 2 3]');
      expect(ast).not.toBeNull();
    });

    it('parses character literal', () => {
      const { ast } = parse('foo ^$A');
      expect(ast).not.toBeNull();
    });

    it('parses negative number', () => {
      const { ast } = parse('foo ^-42');
      expect(ast).not.toBeNull();
    });
  });

  describe('curly array builder', () => {
    it('parses curly array', () => {
      const { ast } = parse('foo ^{1. 2. 3}');
      expect(ast).not.toBeNull();
    });
  });

  describe('pragmas', () => {
    it('parses keyword pragma', () => {
      const { ast } = parse("foo <category: 'accessing'> ^self");
      expect(ast).not.toBeNull();
      expect(ast!.body.pragmas).toHaveLength(1);
    });
  });

  describe('primitive', () => {
    it('parses primitive declaration', () => {
      const { ast } = parse('foo <primitive: 42> ^self');
      expect(ast).not.toBeNull();
      expect(ast!.primitive).toBeDefined();
      expect(ast!.primitive!.number).toBe(42);
    });

    it('parses protected primitive', () => {
      const { ast } = parse('foo <protected primitive: 1> ^self');
      expect(ast).not.toBeNull();
      expect(ast!.primitive!.protection).toBe('protected');
    });
  });

  describe('error recovery', () => {
    it('produces errors for malformed input', () => {
      const { errors } = parse('foo ^)');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('still produces an AST on error', () => {
      const { ast } = parse('foo ^)');
      expect(ast).not.toBeNull();
    });
  });

  describe('paths', () => {
    it('parses dotted path', () => {
      const { ast } = parse('foo ^Globals.Array');
      expect(ast).not.toBeNull();
    });
  });

  describe('paren expressions', () => {
    it('parses parenthesized expression', () => {
      const { ast } = parse('foo ^(1 + 2)');
      expect(ast).not.toBeNull();
    });
  });
});
