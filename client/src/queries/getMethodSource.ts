import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

export function getMethodSource(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
): string {
  const recv = receiver(className, isMeta);
  const code = environmentId === 0
    ? `(${recv} compiledMethodAt: #'${escapeString(selector)}') sourceString`
    : `(${recv} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId}) sourceString`;
  const label = environmentId === 0
    ? `getMethodSource(${recv}>>#${selector})`
    : `getMethodSource(${recv}>>#${selector} env:${environmentId})`;
  return execute(label, code);
}
