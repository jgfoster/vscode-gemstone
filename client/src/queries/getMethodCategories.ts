import { QueryExecutor } from './types';
import { receiver, splitLines } from './util';

export function getMethodCategories(
  execute: QueryExecutor, className: string, isMeta: boolean,
): string[] {
  const recv = receiver(className, isMeta);
  const code = `| ws |
ws := WriteStream on: String new.
${recv} categoryNames asSortedCollection do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute(`getMethodCategories(${recv})`, code));
}
