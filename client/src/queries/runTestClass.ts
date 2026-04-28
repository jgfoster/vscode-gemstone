import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';
import { TestRunResult } from './runTestMethod';

export function runTestClass(
  execute: QueryExecutor, className: string,
): TestRunResult[] {
  const esc = escapeString(className);
  // `result passed`, `result failures`, `result errors` all contain the
  // TestCase instances themselves (only `testSelector` ivar) — verified via
  // probe. Don't send `each testCase`: the wrappers don't respond to it,
  // and on a real failure that branch would DNU. The TestCase instance
  // already carries `class name` and `selector`, same as the passed branch.
  const code = `| suite result ws |
suite := ${esc} suite.
result := suite run.
ws := WriteStream on: Unicode7 new.
result passed do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'passed'; tab; lf].
result failures do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'failed'; tab;
    nextPutAll: (each printString copyFrom: 1 to: (each printString size min: 4096)); lf].
result errors do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'error'; tab;
    nextPutAll: (each printString copyFrom: 1 to: (each printString size min: 4096)); lf].
ws contents`;
  const data = execute(`runTestClass(${className})`, code);
  return splitLines(data).map(line => {
    const parts = line.split('\t');
    return {
      className: parts[0] || className,
      selector: parts[1] || '',
      status: (parts[2] || 'error') as TestRunResult['status'],
      message: parts[3] || '',
      durationMs: 0,
    };
  });
}
