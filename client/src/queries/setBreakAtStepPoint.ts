import { QueryExecutor } from './types';
import { compiledMethodExpr, receiver } from './util';

export function setBreakAtStepPoint(
  execute: QueryExecutor,
  className: string, isMeta: boolean, selector: string,
  stepPoint: number, environmentId: number = 0,
): string {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId);
  const code = `${method} setBreakAtStepPoint: ${stepPoint}. 'ok'`;
  return execute(
    `setBreak(${receiver(className, isMeta)}>>#${selector}, step:${stepPoint})`, code,
  );
}
