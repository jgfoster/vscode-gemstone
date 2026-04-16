import { QueryExecutor } from './types';
import { compiledMethodExpr, receiver, splitLines } from './util';

export function getSourceOffsets(
  execute: QueryExecutor,
  className: string, isMeta: boolean, selector: string, environmentId: number = 0,
): number[] {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId);
  const code = `| ws |
ws := WriteStream on: String new.
${method} _sourceOffsets do: [:each |
  ws nextPutAll: each printString; lf].
ws contents`;
  return splitLines(execute(
    `getSourceOffsets(${receiver(className, isMeta)}>>#${selector})`, code,
  )).map(s => parseInt(s, 10));
}
