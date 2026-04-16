import { QueryExecutor } from './types';
import { compiledMethodExpr, receiver } from './util';

export function clearAllBreaks(
  execute: QueryExecutor,
  className: string, isMeta: boolean, selector: string, environmentId: number = 0,
): string {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId);
  const code = `${method} clearAllBreaks. 'ok'`;
  return execute(
    `clearAllBreaks(${receiver(className, isMeta)}>>#${selector})`, code,
  );
}
