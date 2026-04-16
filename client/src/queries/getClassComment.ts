import { QueryExecutor } from './types';

export function getClassComment(execute: QueryExecutor, className: string): string {
  return execute(`getClassComment(${className})`, `${className} comment`);
}
