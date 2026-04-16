import { QueryExecutor } from './types';

export function canClassBeWritten(execute: QueryExecutor, className: string): boolean {
  const result = execute(`canBeWritten(${className})`, `${className} canBeWritten printString`);
  return result.trim() === 'true';
}
