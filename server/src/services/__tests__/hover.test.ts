import { describe, it, expect } from 'vitest';
import { DocumentManager } from '../../utils/documentManager';
import { getHover } from '../hover';

function hover(source: string, line: number, character: number): string | null {
  const dm = new DocumentManager();
  const doc = dm.update('test://test', 1, source);
  const region = dm.findRegionAt(doc, line);
  const result = getHover(doc, { line, character }, region);
  if (!result) return null;
  return (result.contents as { value: string }).value;
}

describe('Hover', () => {
  describe('pseudo-variables', () => {
    it('self', () => {
      const result = hover('method: Foo\nfoo\n  ^self\n%', 2, 3);
      expect(result).toContain('**self**');
      expect(result).toContain('receiver');
    });

    it('super', () => {
      const result = hover('method: Foo\nfoo\n  ^super foo\n%', 2, 3);
      expect(result).toContain('**super**');
      expect(result).toContain('superclass');
    });

    it('thisContext', () => {
      const result = hover('method: Foo\nfoo\n  ^thisContext\n%', 2, 3);
      expect(result).toContain('**thisContext**');
    });
  });

  describe('special literals', () => {
    it('true', () => {
      const result = hover('method: Foo\nfoo\n  ^true\n%', 2, 3);
      expect(result).toContain('**true**');
      expect(result).toContain('Boolean');
    });

    it('false', () => {
      const result = hover('method: Foo\nfoo\n  ^false\n%', 2, 3);
      expect(result).toContain('**false**');
    });

    it('nil', () => {
      const result = hover('method: Foo\nfoo\n  ^nil\n%', 2, 3);
      expect(result).toContain('**nil**');
      expect(result).toContain('UndefinedObject');
    });
  });

  describe('method-scope variables', () => {
    it('method argument', () => {
      const result = hover('method: Foo\nat: index\n  ^index\n%', 2, 3);
      expect(result).toContain('`index`');
      expect(result).toContain('argument');
    });

    it('temporary variable', () => {
      const result = hover('method: Foo\nfoo | x |\n  ^x\n%', 2, 3);
      expect(result).toContain('`x`');
      expect(result).toContain('temporary');
    });

    it('block parameter', () => {
      //  [:a | a]
      //  01234567890
      const result = hover('method: Foo\nfoo\n  [:a | a]\n%', 2, 8);
      expect(result).toContain('`a`');
      expect(result).toContain('block parameter');
    });

    it('block temporary', () => {
      //  [| t | t]
      //  0123456789
      const result = hover('method: Foo\nfoo\n  [| t | t]\n%', 2, 9);
      expect(result).toContain('`t`');
      expect(result).toContain('block temporary');
    });
  });

  describe('variables not in method scope', () => {
    it('assignment target shows as variable', () => {
      //  grailDir := aString
      //  0123456789...
      const result = hover('method: Foo\ngrailDir: aString\n  grailDir := aString\n%', 2, 2);
      expect(result).toContain('`grailDir`');
      expect(result).toContain('variable');
      expect(result).not.toContain('unary selector');
    });

    it('returned variable shows as variable', () => {
      //  ^grailDir
      //  0123456789
      const result = hover('method: Foo\nfoo\n  ^grailDir\n%', 2, 3);
      expect(result).toContain('`grailDir`');
      expect(result).toContain('variable');
      expect(result).not.toContain('unary selector');
    });

    it('keyword argument shows as variable', () => {
      //  self at: instVar
      //  0123456789012345
      const result = hover('method: Foo\nfoo\n  self at: instVar\n%', 2, 11);
      expect(result).toContain('`instVar`');
      expect(result).toContain('variable');
      expect(result).not.toContain('unary selector');
    });

    it('binary argument shows as variable', () => {
      //  1 + instVar
      //  0123456789
      const result = hover('method: Foo\nfoo\n  1 + instVar\n%', 2, 6);
      expect(result).toContain('`instVar`');
      expect(result).toContain('variable');
      expect(result).not.toContain('unary selector');
    });
  });

  describe('unary selectors', () => {
    it('unary message shows as unary selector', () => {
      //  ^self size
      //  0123456789
      const result = hover('method: Foo\nfoo\n  ^self size\n%', 2, 8);
      expect(result).toContain('`size`');
      expect(result).toContain('unary selector');
    });

    it('method pattern selector shows as unary selector', () => {
      const result = hover('method: Foo\nfoo\n  ^self\n%', 1, 0);
      expect(result).toContain('`foo`');
      expect(result).toContain('unary selector');
    });
  });

  describe('keyword selectors', () => {
    it('shows full composed selector for message send', () => {
      //  self at: 1 put: 2
      //  0123456789...
      const result = hover('method: Foo\nfoo\n  self at: 1 put: 2\n%', 2, 7);
      expect(result).toContain('`at:put:`');
      expect(result).toContain('keyword selector');
    });

    it('shows full composed selector for method pattern', () => {
      const result = hover('method: Foo\nat: index put: value\n  ^value\n%', 1, 0);
      expect(result).toContain('`at:put:`');
      expect(result).toContain('keyword selector');
    });
  });

  describe('numbers', () => {
    it('radixed integer', () => {
      const result = hover('method: Foo\nfoo\n  ^16rFF\n%', 2, 3);
      expect(result).toContain('255');
      expect(result).toContain('base 16');
    });

    it('scaled decimal', () => {
      const result = hover('method: Foo\nfoo\n  ^3.14s2\n%', 2, 3);
      expect(result).toContain('ScaledDecimal');
    });
  });

  describe('symbols', () => {
    it('symbol literal', () => {
      const result = hover('method: Foo\nfoo\n  ^#bar\n%', 2, 3);
      expect(result).toContain('Symbol');
    });
  });

  describe('characters', () => {
    it('character literal', () => {
      const result = hover('method: Foo\nfoo\n  ^$a\n%', 2, 3);
      expect(result).toContain('Character');
    });
  });

  describe('no hover', () => {
    it('returns null for whitespace', () => {
      const result = hover('method: Foo\nfoo\n  ^self\n%', 2, 0);
      expect(result).toBeNull();
    });

    it('returns null for topaz directives', () => {
      const result = hover('method: Foo\nfoo\n  ^self\n%', 0, 0);
      expect(result).toBeNull();
    });
  });
});
