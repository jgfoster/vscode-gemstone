import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface TestRunResult {
  className: string;
  selector: string;
  status: 'passed' | 'failed' | 'error';
  message: string;
  durationMs: number;
}

export function runTestMethod(
  execute: QueryExecutor, className: string, selector: string,
): TestRunResult {
  const esc = escapeString(className);
  const sel = escapeString(selector);
  const code = `| testCase result ws startMs endMs |
startMs := Time millisecondClockValue.
testCase := ${esc} selector: #'${sel}'.
result := testCase run.
endMs := Time millisecondClockValue.
ws := WriteStream on: Unicode7 new.
(result hasPassed)
  ifTrue: [ws nextPutAll: 'passed'; tab; tab]
  ifFalse: [
    result failures size > 0
      ifTrue: [
        | failure |
        failure := result failures asArray first.
        ws nextPutAll: 'failed'; tab;
          nextPutAll: (failure printString copyFrom: 1 to: (failure printString size min: 4096)); tab]
      ifFalse: [
        | err |
        err := result errors asArray first.
        ws nextPutAll: 'error'; tab;
          nextPutAll: (err printString copyFrom: 1 to: (err printString size min: 4096)); tab]].
ws nextPutAll: (endMs - startMs) printString.
ws contents`;
  const data = execute(`runTestMethod(${className}>>#${selector})`, code);
  const parts = data.split('\t');
  return {
    className,
    selector,
    status: (parts[0] || 'error') as TestRunResult['status'],
    message: parts[1] || '',
    durationMs: parseInt(parts[2] || '0', 10) || 0,
  };
}
