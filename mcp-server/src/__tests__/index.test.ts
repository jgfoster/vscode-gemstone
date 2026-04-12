import { describe, it, expect } from 'vitest';
import { parseArgs } from '../index';

describe('parseArgs', () => {
  const validArgs = [
    'node', 'index.js',
    '--library-path', '/path/to/lib.dylib',
    '--stone-nrs', '!tcp@localhost#server!gs64stone',
    '--gem-nrs', '!tcp@localhost#netldi:gs64ldi#task!gemnetobject',
    '--gs-user', 'DataCurator',
    '--gemstone', '/opt/gemstone/3.7.4',
    '--gemstone-global-dir', '/home/user/gemstone',
  ];

  it('parses all required arguments', () => {
    const result = parseArgs(validArgs);

    expect(result.libraryPath).toBe('/path/to/lib.dylib');
    expect(result.stoneNrs).toBe('!tcp@localhost#server!gs64stone');
    expect(result.gemNrs).toBe('!tcp@localhost#netldi:gs64ldi#task!gemnetobject');
    expect(result.gsUser).toBe('DataCurator');
    expect(result.gemstone).toBe('/opt/gemstone/3.7.4');
    expect(result.gemstoneGlobalDir).toBe('/home/user/gemstone');
  });

  it('parses optional host-user argument', () => {
    const args = [...validArgs, '--host-user', 'admin'];
    const result = parseArgs(args);

    expect(result.hostUser).toBe('admin');
  });

  it('returns undefined for missing optional arguments', () => {
    const result = parseArgs(validArgs);

    expect(result.hostUser).toBeUndefined();
  });

  it('throws on missing required argument', () => {
    const args = [
      'node', 'index.js',
      '--library-path', '/path/to/lib.dylib',
    ];

    expect(() => parseArgs(args)).toThrow('Missing required argument');
  });
});
