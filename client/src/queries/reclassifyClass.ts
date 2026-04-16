import { QueryExecutor } from './types';
import { escapeString } from './util';

// Change the class-category metadata (not a GemStone category in the symbolic
// sense — just a string tag used for organizing classes in browsers).
// Not committed automatically.
export function reclassifyClass(
  execute: QueryExecutor, dictIndex: number, className: string, newCategory: string,
): string {
  const code = `((System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}') category: '${escapeString(newCategory)}'. 'ok'`;
  return execute(
    `reclassifyClass(${className} -> '${newCategory}')`, code,
  );
}
