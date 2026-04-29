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
  // Round-3 (and round-2 ask #3 applied to this tool): capture the live
  // exception's class + messageText instead of the SUnit framework's
  // post-run TestCase printString (which is just the debug recipe). We
  // bypass `testCase run` and replicate setUp / perform / tearDown with our
  // own AbstractException handler — same pattern as describe_test_failure.
  // The TestFailure-vs-other-Exception kind discriminates failed/error.
  //
  // Output is built through a Unicode7 stream with per-char ASCII gating
  // so Unicode16 messageText values transcode safely (see python.ts and
  // runFailingTests.ts for the encoding rationale).
  const code = `| testCase captured tdEx ws coerce status startMs endMs |
testCase := ${esc} selector: #'${sel}'.
startMs := Time millisecondClockValue.
captured := nil.
[testCase setUp] on: AbstractException do: [:e | captured := e].
captured isNil ifTrue: [
  [testCase perform: #'${sel}'] on: AbstractException do: [:e | captured := e].
  tdEx := nil.
  [testCase tearDown] on: AbstractException do: [:e | tdEx := e].
  (captured isNil and: [tdEx notNil]) ifTrue: [captured := tdEx]].
endMs := Time millisecondClockValue.

ws := WriteStream on: Unicode7 new.
coerce := [:s | s asString do: [:ch |
  ws nextPut: (ch asInteger < 128 ifTrue: [ch] ifFalse: [$?])]].
captured isNil
  ifTrue: [ws nextPutAll: 'passed'; tab; tab]
  ifFalse: [
    status := (captured isKindOf: TestFailure) ifTrue: ['failed'] ifFalse: ['error'].
    ws nextPutAll: status; tab.
    coerce value: captured class name.
    ws nextPutAll: ': '.
    coerce value: captured messageText.
    ws tab].
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
