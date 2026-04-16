import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';

export interface TestMethodInfo {
  selector: string;
  category: string;
}

export function discoverTestMethods(
  execute: QueryExecutor, className: string,
): TestMethodInfo[] {
  const esc = escapeString(className);
  const code = `| ws |
ws := WriteStream on: Unicode7 new.
${esc} testSelectors asSortedCollection do: [:each |
  ws nextPutAll: each;
    tab;
    nextPutAll: ((${esc} categoryOfSelector: each environmentId: 0) ifNil: ['']);
    lf].
ws contents`;
  const data = execute(`discoverTestMethods(${className})`, code);
  return splitLines(data).map(line => {
    const [selector, category] = line.split('\t');
    return { selector, category: category || '' };
  });
}
