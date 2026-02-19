import { describe, it, expect } from 'vitest';
import { DocumentManager } from '../documentManager';

describe('DocumentManager — smalltalk format', () => {
  describe('method URI (6-part path)', () => {
    const uri = 'gemstone://1/Globals/Array/instance/accessing/size';

    it('produces a single smalltalk-method region', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'size\n  ^self basicSize', 'smalltalk');
      expect(doc.topazRegions).toHaveLength(1);
      expect(doc.topazRegions[0].kind).toBe('smalltalk-method');
    });

    it('sets className from URI path', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'size\n  ^self basicSize', 'smalltalk');
      expect(doc.topazRegions[0].className).toBe('Array');
    });

    it('sets command to "method" for instance side', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'size\n  ^self basicSize', 'smalltalk');
      expect(doc.topazRegions[0].command).toBe('method');
    });

    it('sets command to "classmethod" for class side', () => {
      const dm = new DocumentManager();
      const classUri = 'gemstone://1/Globals/Array/class/creation/new';
      const doc = dm.update(classUri, 1, 'new\n  ^super new', 'smalltalk');
      expect(doc.topazRegions[0].command).toBe('classmethod');
    });

    it('parses a valid AST', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'size\n  ^self basicSize', 'smalltalk');
      expect(doc.ast).not.toBeNull();
      expect(doc.ast!.pattern.selector).toBe('size');
    });

    it('produces tokens', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'size\n  ^self basicSize', 'smalltalk');
      expect(doc.tokens.length).toBeGreaterThan(0);
    });

    it('reports parse errors as diagnostics', () => {
      const dm = new DocumentManager();
      // Unterminated block produces a parse error
      const doc = dm.update(uri, 1, 'size\n  ^[self', 'smalltalk');
      expect(doc.errors.length).toBeGreaterThan(0);
    });
  });

  describe('definition URI (shorter path)', () => {
    const uri = 'gemstone://1/Globals/Array/definition';

    it('produces a single smalltalk-code region', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'Object subclass: #Array', 'smalltalk');
      expect(doc.topazRegions).toHaveLength(1);
      expect(doc.topazRegions[0].kind).toBe('smalltalk-code');
    });

    it('parses statements (not method AST)', () => {
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, '1 + 2', 'smalltalk');
      expect(doc.parsedRegions).toHaveLength(1);
      expect(doc.parsedRegions[0].statements).not.toBeNull();
    });
  });

  describe('encoded URI components', () => {
    it('decodes class name from URI', () => {
      const uri = 'gemstone://1/Globals/My%20Class/instance/accessing/foo';
      const dm = new DocumentManager();
      const doc = dm.update(uri, 1, 'foo\n  ^1', 'smalltalk');
      expect(doc.topazRegions[0].className).toBe('My Class');
    });
  });

  describe('hover works on smalltalk documents', () => {
    it('returns hover for pseudo-variables', () => {
      const dm = new DocumentManager();
      const uri = 'gemstone://1/Globals/Foo/instance/test/bar';
      const doc = dm.update(uri, 1, 'bar\n  ^self', 'smalltalk');
      const region = dm.findRegionAt(doc, 1);
      expect(region).toBeDefined();
    });
  });

  describe('findRegionAt', () => {
    it('returns the region containing the line', () => {
      const dm = new DocumentManager();
      const uri = 'gemstone://1/Globals/Foo/instance/test/bar';
      const doc = dm.update(uri, 1, 'bar\n  ^self size', 'smalltalk');
      const region = dm.findRegionAt(doc, 0);
      expect(region).toBeDefined();
      expect(region!.region.kind).toBe('smalltalk-method');
    });

    it('returns undefined for out-of-range line', () => {
      const dm = new DocumentManager();
      const uri = 'gemstone://1/Globals/Foo/instance/test/bar';
      const doc = dm.update(uri, 1, 'bar\n  ^self', 'smalltalk');
      const region = dm.findRegionAt(doc, 100);
      expect(region).toBeUndefined();
    });
  });
});
