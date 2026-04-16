import { describe, it, expect, vi } from 'vitest';
import { getMethodSource } from '../getMethodSource';

describe('shared getMethodSource', () => {
  it('composes instance-side code without environmentId clause when env is 0', () => {
    const execute = vi.fn(() => 'printOn: aStream');
    const result = getMethodSource(execute, 'Array', false, 'printOn:');

    expect(execute).toHaveBeenCalledWith(
      'getMethodSource(Array>>#printOn:)',
      "(Array compiledMethodAt: #'printOn:') sourceString",
    );
    expect(result).toBe('printOn: aStream');
  });

  it('composes class-side code via "<Class> class" receiver', () => {
    const execute = vi.fn(() => 'new ^super new');
    getMethodSource(execute, 'Array', true, 'new');

    expect(execute).toHaveBeenCalledWith(
      'getMethodSource(Array class>>#new)',
      "(Array class compiledMethodAt: #'new') sourceString",
    );
  });

  it('includes environmentId clause when non-zero', () => {
    const execute = vi.fn(() => '');
    getMethodSource(execute, 'Array', false, 'size', 2);

    expect(execute).toHaveBeenCalledWith(
      'getMethodSource(Array>>#size env:2)',
      "(Array compiledMethodAt: #'size' environmentId: 2) sourceString",
    );
  });

  it("escapes single quotes in selectors", () => {
    const execute = vi.fn(() => '');
    getMethodSource(execute, 'Array', false, "o'clock");

    expect(execute).toHaveBeenCalledWith(
      "getMethodSource(Array>>#o'clock)",
      "(Array compiledMethodAt: #'o''clock') sourceString",
    );
  });

  it('propagates the executor return value unchanged', () => {
    const execute = vi.fn(() => 'abc\n\ndef');
    expect(getMethodSource(execute, 'X', false, 'y')).toBe('abc\n\ndef');
  });
});
