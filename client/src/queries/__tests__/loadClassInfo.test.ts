import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { loadClassInfo } from '../loadClassInfo';

describe('loadClassInfo', () => {
  it('parses all four fields from a single round-trip response', () => {
    const raw = [
      'Globals\ttrue',
      "Object subclass: 'Foo'",
      '  instVarNames: #()',
      '===COMMENT===',
      'A test class',
    ].join('\n');
    const execute = vi.fn<QueryExecutor>(() => raw);
    const info = loadClassInfo(execute, 1, 'Foo');

    expect(info.superclassDictName).toBe('Globals');
    expect(info.canBeWritten).toBe(true);
    expect(info.definition).toBe("Object subclass: 'Foo'\n  instVarNames: #()");
    expect(info.comment).toBe('A test class');
  });

  it('handles empty comment', () => {
    const raw = 'Globals\tfalse\nObject subclass: \'X\'\n===COMMENT===\n';
    const execute = vi.fn<QueryExecutor>(() => raw);
    const info = loadClassInfo(execute, 1, 'X');

    expect(info.comment).toBe('');
    expect(info.canBeWritten).toBe(false);
  });

  it('handles multi-line comment', () => {
    const raw = 'Globals\ttrue\nDef line\n===COMMENT===\nLine 1\nLine 2';
    const execute = vi.fn<QueryExecutor>(() => raw);
    const info = loadClassInfo(execute, 1, 'X');

    expect(info.comment).toBe('Line 1\nLine 2');
  });

  it('handles missing superclass (empty dict name)', () => {
    const raw = '\ttrue\nDef\n===COMMENT===\n';
    const execute = vi.fn<QueryExecutor>(() => raw);
    const info = loadClassInfo(execute, 1, 'X');

    expect(info.superclassDictName).toBe('');
  });

  it('embeds dictIndex and escaped class name in the Smalltalk', () => {
    const execute = vi.fn<QueryExecutor>(() => '\tfalse\nDef\n===COMMENT===\n');
    loadClassInfo(execute, 3, "Foo'Bar");
    const code = execute.mock.calls[0][1];
    expect(code).toContain('symbolList at: 3');
    expect(code).toContain("#'Foo''Bar'");
  });

  it('wraps comment and canBeWritten in on:do: error handlers', () => {
    const execute = vi.fn<QueryExecutor>(() => '\tfalse\nDef\n===COMMENT===\n');
    loadClassInfo(execute, 1, 'X');
    const code = execute.mock.calls[0][1];
    expect(code).toContain("on: Error do:");
  });
});
