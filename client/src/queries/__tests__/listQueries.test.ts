import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getDictionaryNames } from '../getDictionaryNames';
import { getPoolDictionaryNames } from '../getPoolDictionaryNames';
import { getClassNames } from '../getClassNames';
import { getMethodCategories } from '../getMethodCategories';
import { getMethodSelectors } from '../getMethodSelectors';
import { getInstVarNames } from '../getInstVarNames';
import { getAllSelectors } from '../getAllSelectors';
import { getSourceOffsets } from '../getSourceOffsets';

describe('getDictionaryNames', () => {
  it('parses newline-separated names', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Globals\nUserGlobals\n');
    expect(getDictionaryNames(execute)).toEqual(['Globals', 'UserGlobals']);
  });

  it('returns [] for empty output', () => {
    expect(getDictionaryNames(vi.fn<QueryExecutor>(() => ''))).toEqual([]);
  });
});

describe('getPoolDictionaryNames', () => {
  it('probes for SymbolDictionary instances in symbolList', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Globals\nMyPool\n');
    expect(getPoolDictionaryNames(execute)).toEqual(['Globals', 'MyPool']);
    expect(execute.mock.calls[0][1]).toContain('isKindOf: SymbolDictionary');
  });
});

describe('getClassNames', () => {
  it('sorts class names alphabetically', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Zebra\nApple\nMango\n');
    expect(getClassNames(execute, 1)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('embeds dictIndex in the Smalltalk code when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassNames(execute, 7);
    expect(execute.mock.calls[0][1]).toContain('symbolList at: 7');
  });

  it('uses objectNamed: when given a dictionary name', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Array\n');
    getClassNames(execute, 'Globals');
    expect(execute.mock.calls[0][1]).toContain("objectNamed: #'Globals'");
    expect(execute.mock.calls[0][0]).toBe('getClassNames(dictName: Globals)');
  });

  it('escapes single quotes in dictionary names', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassNames(execute, "it's");
    expect(execute.mock.calls[0][1]).toContain("objectNamed: #'it''s'");
  });

  it('returns [] for unknown dictionary names (Smalltalk returns empty)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    expect(getClassNames(execute, 'NoSuchDict')).toEqual([]);
  });
});

describe('getMethodCategories', () => {
  it('uses "<class>" receiver for instance side', () => {
    const execute = vi.fn<QueryExecutor>(() => 'accessing\nprinting\n');
    expect(getMethodCategories(execute, 'Array', false)).toEqual(['accessing', 'printing']);
    expect(execute.mock.calls[0][1]).toContain('Array categoryNames');
  });

  it('uses "<class> class" receiver for class side', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodCategories(execute, 'Array', true);
    expect(execute.mock.calls[0][1]).toContain('Array class categoryNames');
  });
});

describe('getMethodSelectors', () => {
  it('escapes single quotes in the category', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodSelectors(execute, 'Array', false, "foo's");
    expect(execute.mock.calls[0][1]).toContain("'foo''s'");
  });
});

describe('getInstVarNames', () => {
  it('parses allInstVarNames output', () => {
    const execute = vi.fn<QueryExecutor>(() => 'name\nsize\n');
    expect(getInstVarNames(execute, 'Foo')).toEqual(['name', 'size']);
    expect(execute.mock.calls[0][1]).toContain('Foo allInstVarNames');
  });
});

describe('getAllSelectors', () => {
  it('parses allSelectors sorted output', () => {
    const execute = vi.fn<QueryExecutor>(() => 'at:\nsize\n');
    expect(getAllSelectors(execute, 'Foo')).toEqual(['at:', 'size']);
    expect(execute.mock.calls[0][1]).toContain('Foo allSelectors asSortedCollection');
  });
});

describe('getSourceOffsets', () => {
  it('parses integer offsets from lines', () => {
    const execute = vi.fn<QueryExecutor>(() => '1\n5\n12\n');
    expect(getSourceOffsets(execute, 'Array', false, 'size')).toEqual([1, 5, 12]);
  });

  it('passes environmentId to compiledMethodAt:', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getSourceOffsets(execute, 'Array', false, 'size', 2);
    expect(execute.mock.calls[0][1]).toContain('environmentId: 2');
  });
});
