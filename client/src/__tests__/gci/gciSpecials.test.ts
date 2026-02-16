import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import {
  OOP_ILLEGAL, OOP_NIL, OOP_FALSE, OOP_TRUE, OOP_ASCII_NUL,
  OOP_Zero, OOP_One, OOP_Two, OOP_Three,
  OOP_CLASS_BOOLEAN, OOP_CLASS_CHARACTER,
  OOP_CLASS_SMALL_INTEGER, OOP_CLASS_UNDEFINED_OBJECT,
  OOP_CLASS_SMALL_DOUBLE,
} from '../../gciConstants';

const libraryPath = process.env.GCI_LIBRARY_PATH;
if (!libraryPath) {
  console.error('GCI_LIBRARY_PATH not set. Skipping GCI tests.');
  process.exit(1);
}

describe('GCI session-free OOP functions', () => {
  const gci = new GciLibrary(libraryPath);

  afterAll(() => {
    gci.close();
  });

  describe('GciTsOopIsSpecial', () => {
    it('returns true for OOP_NIL', () => {
      expect(gci.GciTsOopIsSpecial(OOP_NIL)).toBe(true);
    });

    it('returns true for OOP_TRUE', () => {
      expect(gci.GciTsOopIsSpecial(OOP_TRUE)).toBe(true);
    });

    it('returns true for OOP_FALSE', () => {
      expect(gci.GciTsOopIsSpecial(OOP_FALSE)).toBe(true);
    });

    it('returns true for SmallInteger 0', () => {
      expect(gci.GciTsOopIsSpecial(OOP_Zero)).toBe(true);
    });

    it('returns true for a Character', () => {
      expect(gci.GciTsOopIsSpecial(OOP_ASCII_NUL)).toBe(true);
    });
  });

  describe('GciTsFetchSpecialClass', () => {
    it('returns UndefinedObject for OOP_NIL', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_NIL)).toBe(OOP_CLASS_UNDEFINED_OBJECT);
    });

    it('returns Boolean for OOP_TRUE', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_TRUE)).toBe(OOP_CLASS_BOOLEAN);
    });

    it('returns Boolean for OOP_FALSE', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_FALSE)).toBe(OOP_CLASS_BOOLEAN);
    });

    it('returns SmallInteger for OOP_Zero', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_Zero)).toBe(OOP_CLASS_SMALL_INTEGER);
    });

    it('returns Character for OOP_ASCII_NUL', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_ASCII_NUL)).toBe(OOP_CLASS_CHARACTER);
    });

    it('returns OOP_ILLEGAL for a non-special OOP', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_ILLEGAL)).toBe(OOP_ILLEGAL);
    });
  });

  describe('GciI32ToOop / GciTsI32ToOop', () => {
    it('encodes 0 as OOP_Zero', () => {
      expect(gci.GciI32ToOop(0)).toBe(OOP_Zero);
    });

    it('encodes 1 as OOP_One', () => {
      expect(gci.GciI32ToOop(1)).toBe(OOP_One);
    });

    it('encodes 2 as OOP_Two', () => {
      expect(gci.GciI32ToOop(2)).toBe(OOP_Two);
    });

    it('encodes 3 as OOP_Three', () => {
      expect(gci.GciI32ToOop(3)).toBe(OOP_Three);
    });

    it('GciI32ToOop and GciTsI32ToOop return the same result', () => {
      for (const n of [0, 1, -1, 42, -100, 2147483647, -2147483648]) {
        expect(gci.GciI32ToOop(n)).toBe(gci.GciTsI32ToOop(n));
      }
    });

    it('result is always a SmallInteger special', () => {
      for (const n of [0, 1, -1, 42, 1000]) {
        expect(gci.GciTsOopIsSpecial(gci.GciI32ToOop(n))).toBe(true);
        expect(gci.GciTsFetchSpecialClass(gci.GciI32ToOop(n))).toBe(OOP_CLASS_SMALL_INTEGER);
      }
    });
  });

  describe('GciTsCharToOop / GciTsOopToChar', () => {
    it('round-trips ASCII characters', () => {
      for (const ch of [0, 65, 90, 97, 122, 127]) {
        const oop = gci.GciTsCharToOop(ch);
        expect(gci.GciTsOopToChar(oop)).toBe(ch);
      }
    });

    it('round-trips Unicode code points', () => {
      for (const ch of [0x00E9, 0x4E16, 0x1F600, 0x10FFFF]) {
        const oop = gci.GciTsCharToOop(ch);
        expect(gci.GciTsOopToChar(oop)).toBe(ch);
      }
    });

    it('Character OOPs are recognized as special', () => {
      const oop = gci.GciTsCharToOop(65);
      expect(gci.GciTsOopIsSpecial(oop)).toBe(true);
      expect(gci.GciTsFetchSpecialClass(oop)).toBe(OOP_CLASS_CHARACTER);
    });

    it('returns OOP_ILLEGAL for code points above U+10FFFF', () => {
      expect(gci.GciTsCharToOop(0x110000)).toBe(OOP_ILLEGAL);
    });

    it('returns -1 for non-Character OOPs', () => {
      expect(gci.GciTsOopToChar(OOP_NIL)).toBe(-1);
      expect(gci.GciTsOopToChar(OOP_Zero)).toBe(-1);
    });
  });

  describe('GciTsDoubleToSmallDouble', () => {
    it('encodes 0.0 as a special OOP', () => {
      const oop = gci.GciTsDoubleToSmallDouble(0.0);
      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsOopIsSpecial(oop)).toBe(true);
      expect(gci.GciTsFetchSpecialClass(oop)).toBe(OOP_CLASS_SMALL_DOUBLE);
    });

    it('encodes 1.0 as a special OOP', () => {
      const oop = gci.GciTsDoubleToSmallDouble(1.0);
      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchSpecialClass(oop)).toBe(OOP_CLASS_SMALL_DOUBLE);
    });

    it('returns OOP_ILLEGAL for NaN', () => {
      expect(gci.GciTsDoubleToSmallDouble(NaN)).toBe(OOP_ILLEGAL);
    });

    it('returns OOP_ILLEGAL for Infinity', () => {
      expect(gci.GciTsDoubleToSmallDouble(Infinity)).toBe(OOP_ILLEGAL);
    });
  });
});
