import { QueryExecutor } from './types';

export function abortTransaction(execute: QueryExecutor): string {
  return execute('abortTransaction', `System abortTransaction. 'Transaction aborted'`);
}
