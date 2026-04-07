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

    it('parses greater-than as binary message', () => {
      const { ast, errors } = parse('foo ^(2 + 3 > 4)');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
    });

    it('parses less-than as binary message', () => {
      const { ast, errors } = parse('foo ^(2 + 3 < 4)');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
    });

    it('parses pipe as binary message', () => {
      const { ast, errors } = parse('foo ^(true | false)');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
    });

    it('parses ampersand as binary message', () => {
      const { ast, errors } = parse('foo ^(true & false)');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
    });

    it('parses pipe in complex expression', () => {
      const { ast, errors } = parse('foo | x | ^((x < 1) | (x > 10))');
      expect(errors).toHaveLength(0);
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

    it('parses block with keyword message followed by assignment', () => {
      const { ast, errors } = parse('foo | i | i timesRepeat: [| x | Array new: i. x := 2]');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
    });

    it('treats dot with whitespace as statement separator not path', () => {
      const { ast, errors } = parse('foo | i x | i. x := 2');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
      expect(ast!.body.statements).toHaveLength(2);
    });

    it('treats dot without whitespace as path separator', () => {
      const { ast, errors } = parse('foo ^Foo.Bar');
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
      const ret = ast!.body.statements[0];
      expect(ret.kind).toBe('Return');
      if (ret.kind === 'Return') {
        expect(ret.expression.kind).toBe('Expression');
        if (ret.expression.kind === 'Expression') {
          expect(ret.expression.receiver.kind).toBe('Path');
        }
      }
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

  describe('env specifier on messages', () => {
    function findMessages(source: string) {
      const { ast, errors } = parse(source);
      expect(errors).toHaveLength(0);
      expect(ast).not.toBeNull();
      const stmt = ast!.body.statements[0];
      // Statement may be Return wrapping Expression, or an Expression
      const expr = stmt.kind === 'Return'
        ? stmt.expression
        : (stmt.kind === 'Expression' ? stmt : null);
      expect(expr).not.toBeNull();
      return expr!;
    }

    it('parses env specifier on a top-level unary message', () => {
      const expr = findMessages('foo 3 @env2:squared');
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('UnaryMessage');
      if (msg.kind === 'UnaryMessage') {
        expect(msg.selector).toBe('squared');
        expect(msg.envSpecifier).toBe('@env2:');
      }
    });

    it('parses env specifier on a top-level binary message', () => {
      const expr = findMessages('foo 2 @env1:+ 3');
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('BinaryMessage');
      if (msg.kind === 'BinaryMessage') {
        expect(msg.selector).toBe('+');
        expect(msg.envSpecifier).toBe('@env1:');
      }
    });

    it('parses env specifier on a top-level keyword message', () => {
      const expr = findMessages('foo Transcript @env0:show: 2');
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('KeywordMessage');
      if (msg.kind === 'KeywordMessage') {
        expect(msg.selector).toBe('show:');
        expect(msg.envSpecifier).toBe('@env0:');
        expect(msg.parts).toHaveLength(1);
      }
    });

    it('parses the BNF docstring example with env specifiers on each message', () => {
      const expr = findMessages('foo Transcript @env0:show: 2 @env1:+ 3 @env2:squared');
      // Receiver is Transcript, then a single keyword message show: with env0
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('KeywordMessage');
      if (msg.kind === 'KeywordMessage') {
        expect(msg.envSpecifier).toBe('@env0:');
        expect(msg.parts).toHaveLength(1);
        // The argument: 2 + 3 squared
        const arg = msg.parts[0].value;
        // arg has receiver=2, then binary +, with binary's argument being "3 squared"
        expect(arg.receiver.kind).toBe('NumberLiteral');
        // Should have one binary message on the keyword argument with @env1:
        expect(arg.messages).toHaveLength(1);
        const bin = arg.messages[0];
        expect(bin.kind).toBe('BinaryMessage');
        if (bin.kind === 'BinaryMessage') {
          expect(bin.selector).toBe('+');
          expect(bin.envSpecifier).toBe('@env1:');
          // The binary argument has receiver=3, with one unary squared with @env2:
          expect(bin.argument.receiver.kind).toBe('NumberLiteral');
          expect(bin.argument.messages).toHaveLength(1);
          const unary = bin.argument.messages[0];
          expect(unary.kind).toBe('UnaryMessage');
          if (unary.kind === 'UnaryMessage') {
            expect(unary.selector).toBe('squared');
            expect(unary.envSpecifier).toBe('@env2:');
          }
        }
      }
    });

    it('parses env specifier on a unary message inside a binary argument', () => {
      const expr = findMessages('foo 1 + 3 @env0:squared');
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('BinaryMessage');
      if (msg.kind === 'BinaryMessage') {
        expect(msg.selector).toBe('+');
        expect(msg.argument.messages).toHaveLength(1);
        const inner = msg.argument.messages[0];
        expect(inner.kind).toBe('UnaryMessage');
        if (inner.kind === 'UnaryMessage') {
          expect(inner.selector).toBe('squared');
          expect(inner.envSpecifier).toBe('@env0:');
        }
      }
    });

    it('parses env specifier on a unary message inside a keyword argument', () => {
      const expr = findMessages('foo self foo: 3 @env0:squared');
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('KeywordMessage');
      if (msg.kind === 'KeywordMessage') {
        const arg = msg.parts[0].value;
        expect(arg.messages).toHaveLength(1);
        const inner = arg.messages[0];
        expect(inner.kind).toBe('UnaryMessage');
        if (inner.kind === 'UnaryMessage') {
          expect(inner.selector).toBe('squared');
          expect(inner.envSpecifier).toBe('@env0:');
        }
      }
    });

    it('parses env specifier on a binary message inside a keyword argument', () => {
      const expr = findMessages('foo self foo: 3 @env0:+ 4');
      expect(expr.messages).toHaveLength(1);
      const msg = expr.messages[0];
      expect(msg.kind).toBe('KeywordMessage');
      if (msg.kind === 'KeywordMessage') {
        const arg = msg.parts[0].value;
        expect(arg.messages).toHaveLength(1);
        const inner = arg.messages[0];
        expect(inner.kind).toBe('BinaryMessage');
        if (inner.kind === 'BinaryMessage') {
          expect(inner.selector).toBe('+');
          expect(inner.envSpecifier).toBe('@env0:');
        }
      }
    });

    it('parses env specifier on cascade unary message', () => {
      const expr = findMessages('foo self bar; @env0:baz');
      expect(expr.cascades).toHaveLength(1);
      const cascade = expr.cascades[0];
      expect(cascade.kind).toBe('UnaryMessage');
      if (cascade.kind === 'UnaryMessage') {
        expect(cascade.selector).toBe('baz');
        expect(cascade.envSpecifier).toBe('@env0:');
      }
    });

    it('parses env specifier on cascade binary message', () => {
      const expr = findMessages('foo self bar; @env1:+ 2');
      expect(expr.cascades).toHaveLength(1);
      const cascade = expr.cascades[0];
      expect(cascade.kind).toBe('BinaryMessage');
      if (cascade.kind === 'BinaryMessage') {
        expect(cascade.selector).toBe('+');
        expect(cascade.envSpecifier).toBe('@env1:');
      }
    });

    it('parses env specifier on cascade keyword message', () => {
      const expr = findMessages('foo Transcript show: 1; @env0:show: 2');
      expect(expr.cascades).toHaveLength(1);
      const cascade = expr.cascades[0];
      expect(cascade.kind).toBe('KeywordMessage');
      if (cascade.kind === 'KeywordMessage') {
        expect(cascade.selector).toBe('show:');
        expect(cascade.envSpecifier).toBe('@env0:');
      }
    });
  });
});
