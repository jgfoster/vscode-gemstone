import { QueryExecutor } from './types';

export function getClassDefinition(execute: QueryExecutor, className: string): string {
  return execute(`getClassDefinition(${className})`, `${className} definition`);
}
