import { describe, it, expect } from 'vitest';
import { parseTopazDocument, findRegionAtLine } from '../topazParser';

describe('TopazParser', () => {
  it('parses a simple run block', () => {
    const text = `set gems localhost
login
run
| x |
x := 42.
^x
%
logout`;
    const regions = parseTopazDocument(text);
    expect(regions).toHaveLength(3); // topaz commands, run block, topaz commands

    const codeRegion = regions.find((r) => r.kind === 'smalltalk-code');
    expect(codeRegion).toBeDefined();
    expect(codeRegion!.command).toBe('run');
    expect(codeRegion!.text).toContain('x := 42');
    expect(codeRegion!.startLine).toBe(3);
    expect(codeRegion!.endLine).toBe(5);
  });

  it('parses a method definition', () => {
    const text = `method: Array
at: index
  ^self basicAt: index
%`;
    const regions = parseTopazDocument(text);

    const methodRegion = regions.find((r) => r.kind === 'smalltalk-method');
    expect(methodRegion).toBeDefined();
    expect(methodRegion!.command).toBe('method');
    expect(methodRegion!.className).toBe('Array');
    expect(methodRegion!.text).toContain('at: index');
  });

  it('parses classmethod', () => {
    const text = `classmethod: Array
new
  ^super new initialize
%`;
    const regions = parseTopazDocument(text);

    const methodRegion = regions.find((r) => r.kind === 'smalltalk-method');
    expect(methodRegion).toBeDefined();
    expect(methodRegion!.command).toBe('classmethod');
    expect(methodRegion!.className).toBe('Array');
  });

  it('parses multiple Smalltalk blocks', () => {
    const text = `login
run
1 + 2
%
method: Foo
bar ^self
%
doit
3 + 4
%
logout`;
    const regions = parseTopazDocument(text);

    const codeRegions = regions.filter((r) => r.kind === 'smalltalk-code');
    const methodRegions = regions.filter((r) => r.kind === 'smalltalk-method');

    expect(codeRegions).toHaveLength(2); // run and doit
    expect(methodRegions).toHaveLength(1);
  });

  it('handles method without class name', () => {
    const text = `method
bar ^self
%`;
    const regions = parseTopazDocument(text);

    const methodRegion = regions.find((r) => r.kind === 'smalltalk-method');
    expect(methodRegion).toBeDefined();
    expect(methodRegion!.className).toBeUndefined();
  });

  it('topaz-only file has only topaz regions', () => {
    const text = `set gems localhost
login
commit
logout
exit`;
    const regions = parseTopazDocument(text);

    expect(regions).toHaveLength(1);
    expect(regions[0].kind).toBe('topaz');
  });

  it('findRegionAtLine finds the correct region', () => {
    const text = `login
run
| x |
x := 1
%
logout`;
    const regions = parseTopazDocument(text);

    const region = findRegionAtLine(regions, 3);
    expect(region).toBeDefined();
    expect(region!.kind).toBe('smalltalk-code');

    const topazRegion = findRegionAtLine(regions, 0);
    expect(topazRegion).toBeDefined();
    expect(topazRegion!.kind).toBe('topaz');
  });

  it('handles print command', () => {
    const text = `print
42
%`;
    const regions = parseTopazDocument(text);
    const codeRegion = regions.find((r) => r.kind === 'smalltalk-code');
    expect(codeRegion).toBeDefined();
    expect(codeRegion!.command).toBe('print');
  });

  it('handles doit command', () => {
    const text = `doit
System commitTransaction.
%`;
    const regions = parseTopazDocument(text);
    const codeRegion = regions.find((r) => r.kind === 'smalltalk-code');
    expect(codeRegion).toBeDefined();
    expect(codeRegion!.command).toBe('doit');
  });
});
