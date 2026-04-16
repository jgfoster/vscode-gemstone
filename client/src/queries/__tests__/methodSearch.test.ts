import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  searchMethodSource, sendersOf, implementorsOf, referencesToObject,
} from '../methodSearch';

const row = 'Globals\tArray\t0\tsize\taccessing\n';

describe('methodSearch shared parser', () => {
  it('parses tab-separated rows into MethodSearchResult', () => {
    const results = searchMethodSource(vi.fn<QueryExecutor>(() => row), 'size', true);
    expect(results).toEqual([{
      dictName: 'Globals', className: 'Array', isMeta: false,
      selector: 'size', category: 'accessing',
    }]);
  });

  it('returns [] for empty output', () => {
    expect(sendersOf(vi.fn<QueryExecutor>(() => ''), 'nope')).toEqual([]);
  });

  it('maps isMeta=true when the third column is "1"', () => {
    const raw = 'Globals\tArray\t1\tnew\tinstance creation\n';
    const results = implementorsOf(vi.fn<QueryExecutor>(() => raw), 'new');
    expect(results[0].isMeta).toBe(true);
  });
});

describe('searchMethodSource', () => {
  it('passes ignoreCase flag and escaped term to Smalltalk', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    searchMethodSource(execute, "foo's", false);
    const code = execute.mock.calls[0][1];
    expect(code).toContain("substringSearch: 'foo''s' ignoreCase: false");
  });
});

describe('sendersOf', () => {
  it('uses sendersOf: and "at: 1" to unwrap the result array', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    sendersOf(execute, 'size');
    const code = execute.mock.calls[0][1];
    expect(code).toContain("sendersOf: #'size'");
    expect(code).toMatch(/sendersOf: #'size'\) at: 1/s);
  });

  it('propagates environmentId to both the query and the serialization', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    sendersOf(execute, 'x', 3);
    const code = execute.mock.calls[0][1];
    expect(code).toContain('environmentId: 3');
    expect(code).toContain('categoryOfSelector: each selector environmentId: 3');
  });
});

describe('implementorsOf', () => {
  it('uses implementorsOf: and asArray to normalize the collection', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    implementorsOf(execute, 'size');
    const code = execute.mock.calls[0][1];
    expect(code).toContain("implementorsOf: #'size'");
    expect(code).toContain('asArray');
  });
});

describe('referencesToObject', () => {
  it('uses ClassOrganizer referencesToObject: with objectNamed: lookup', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    referencesToObject(execute, 'MyGlobal');
    const code = execute.mock.calls[0][1];
    expect(code).toContain('referencesToObject:');
    expect(code).toContain("objectNamed: #'MyGlobal'");
  });
});
