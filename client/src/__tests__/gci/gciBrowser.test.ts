import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock vscode since browserQueries → gciLog → vscode
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { GciLibrary } from '../../gciLibrary';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as queries from '../../browserQueries';

const libraryPath = process.env.GCI_LIBRARY_PATH;
if (!libraryPath) {
  console.error('GCI_LIBRARY_PATH not set. Skipping GCI browser tests.');
  process.exit(1);
}

const STONE_NRS = '!tcp@localhost#server!gs64stone';
const GEM_NRS = '!tcp@localhost#netldi:50377#task!gemnetobject';
const GS_USER = 'DataCurator';
const GS_PASSWORD = 'swordfish';

describe('Browser Queries (integration)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;

  beforeAll(() => {
    gci = new GciLibrary(libraryPath);
    const login = gci.GciTsLogin(
      STONE_NRS, null, null, false,
      GEM_NRS, GS_USER, GS_PASSWORD, 0, 0,
    );
    expect(login.session).not.toBeNull();

    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      stoneVersion: '3.7.2',
    };
  });

  afterAll(() => {
    if (session?.handle) {
      gci.GciTsLogout(session.handle);
    }
    gci.close();
  });

  describe('getDictionaryNames', () => {
    it('returns an array of dictionary names', () => {
      const names = queries.getDictionaryNames(session);
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      // DataCurator should have at least UserGlobals and Globals
      expect(names).toContain('UserGlobals');
      expect(names).toContain('Globals');
    });
  });

  describe('getClassNames', () => {
    it('returns class names from Globals', () => {
      const names = queries.getClassNames(session, 'Globals');
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      // Array and String should be in Globals
      expect(names).toContain('Array');
      expect(names).toContain('String');
    });

    it('returns sorted names', () => {
      const names = queries.getClassNames(session, 'Globals');
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });
  });

  describe('getMethodCategories', () => {
    it('returns categories for instance side', () => {
      const categories = queries.getMethodCategories(session, 'Array', false);
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    it('returns categories for class side', () => {
      const categories = queries.getMethodCategories(session, 'Array', true);
      expect(Array.isArray(categories)).toBe(true);
      // Class side may have fewer categories but should still have some
    });
  });

  describe('getMethodSelectors', () => {
    it('returns selectors for a known category', () => {
      // First get a real category name
      const categories = queries.getMethodCategories(session, 'Array', false);
      expect(categories.length).toBeGreaterThan(0);

      const selectors = queries.getMethodSelectors(session, 'Array', false, categories[0]);
      expect(Array.isArray(selectors)).toBe(true);
      expect(selectors.length).toBeGreaterThan(0);
    });

    it('works on class side', () => {
      const categories = queries.getMethodCategories(session, 'Array', true);
      if (categories.length > 0) {
        const selectors = queries.getMethodSelectors(session, 'Array', true, categories[0]);
        expect(Array.isArray(selectors)).toBe(true);
      }
    });
  });

  describe('getMethodSource', () => {
    it('returns source for a known method', () => {
      const categories = queries.getMethodCategories(session, 'Array', false);
      const selectors = queries.getMethodSelectors(session, 'Array', false, categories[0]);
      expect(selectors.length).toBeGreaterThan(0);

      const source = queries.getMethodSource(session, 'Array', false, selectors[0]);
      expect(typeof source).toBe('string');
      expect(source.length).toBeGreaterThan(0);
    });
  });

  describe('getClassDefinition', () => {
    it('returns a definition string for Array', () => {
      const def = queries.getClassDefinition(session, 'Array');
      expect(typeof def).toBe('string');
      expect(def.length).toBeGreaterThan(0);
      // Should mention Array somewhere
      expect(def).toContain('Array');
    });
  });

  describe('getClassComment', () => {
    it('returns a comment string for Array', () => {
      const comment = queries.getClassComment(session, 'Array');
      expect(typeof comment).toBe('string');
      // Comment might be empty for some classes, that's OK
    });
  });

  describe('compileMethod and deleteMethod', () => {
    // Use a user-owned class instead of Array (system classes are protected
    // by SystemObjectSecurityPolicy and DataCurator can't modify them).
    const testClass = 'VsCodeBrowserTest';
    const testCategory = 'test-vscode-extension';
    const testSelector = 'vsCodeTestMethod42';
    const testSource = `${testSelector}\n  "test method"\n  ^ 42`;

    beforeAll(() => {
      // Create a temporary class in UserGlobals that DataCurator owns
      queries.compileClassDefinition(session,
        `Object subclass: '${testClass}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`);
    });

    afterAll(() => {
      // Cleanup: remove the test method if it exists, then the class
      try {
        queries.deleteMethod(session, testClass, false, testSelector);
      } catch {
        // ignore if not there
      }
      try {
        queries.deleteClass(session, 'UserGlobals', testClass);
      } catch {
        // ignore
      }
    });

    it('compiles a new method', () => {
      const result = queries.compileMethod(
        session, testClass, false, testCategory, testSource,
      );
      expect(result).not.toBe(0n);
    });

    it('the compiled method source is retrievable', () => {
      const source = queries.getMethodSource(session, testClass, false, testSelector);
      expect(source).toContain(testSelector);
    });

    it('the method appears in the category', () => {
      const selectors = queries.getMethodSelectors(session, testClass, false, testCategory);
      expect(selectors).toContain(testSelector);
    });

    it('deletes the method', () => {
      queries.deleteMethod(session, testClass, false, testSelector);
      // Verify it's gone by checking the category
      const selectors = queries.getMethodSelectors(session, testClass, false, testCategory);
      expect(selectors).not.toContain(testSelector);
    });
  });
});
