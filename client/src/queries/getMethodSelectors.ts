import { QueryExecutor } from './types';
import { escapeString, receiver, splitLines } from './util';

export function getMethodSelectors(
  execute: QueryExecutor, className: string, isMeta: boolean, category: string,
): string[] {
  const recv = receiver(className, isMeta);
  const code = `| ws |
ws := WriteStream on: String new.
(${recv} sortedSelectorsIn: '${escapeString(category)}')
  do: [:each |
    ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute(`getMethodSelectors(${recv}, '${category}')`, code));
}
