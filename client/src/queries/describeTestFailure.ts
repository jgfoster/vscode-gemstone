import { QueryExecutor } from './types';
import { escapeString } from './util';

// Structured details about a single SUnit test's outcome — the fields agents
// need to diagnose a failure without re-reading the raw printString blob.
//
// Why we re-run the test (instead of digesting the prior TestResult):
// SUnit's TestCase>>run catches the raised exception inside its own handler
// to record "this test failed/errored," then discards the exception. By the
// time `result failures` / `result errors` are populated, the items inside
// are TestCase instances themselves (only `testSelector` ivar) with no
// reference to what was raised. To get exception class / messageText /
// description / receiver / selector we have to re-run the test with our own
// AbstractException handler that captures the live exception.
export interface TestFailureDetails {
  status: 'passed' | 'failed' | 'error';
  exceptionClass?: string;
  errorNumber?: number;
  messageText?: string;
  description?: string;
  // For MessageNotUnderstood specifically: the receiver and the missing
  // selector. These are the highest-signal fields for MNU debugging — they
  // tell the agent exactly which method needs to be implemented or which
  // call site has the wrong receiver class.
  mnuReceiver?: string;
  mnuSelector?: string;
}

export function describeTestFailure(
  execute: QueryExecutor,
  className: string,
  selector: string,
): TestFailureDetails {
  const cls = escapeString(className);
  const sel = escapeString(selector);
  // Why AbstractException (not Exception): GemStone's Exception class can be
  // shadowed in user environments, and MessageNotUnderstood inherits from
  // AbstractException directly in some session contexts — using Exception
  // would let real errors escape past our handler. AbstractException is the
  // documented root.
  //
  // Why match SUnit's setUp/test/tearDown ordering manually: we bypass
  // TestCase>>run because that's the method that swallows the exception.
  // We replicate its lifecycle (skip the test body if setUp blew up;
  // surface a tearDown failure only if the test body itself succeeded).
  const code = `| tc captured tdEx ws cleanText |
tc := ${cls} selector: #'${sel}'.
captured := nil.
[tc setUp] on: AbstractException do: [:e | captured := e].
captured isNil ifTrue: [
  [tc perform: #'${sel}'] on: AbstractException do: [:e | captured := e].
  tdEx := nil.
  [tc tearDown] on: AbstractException do: [:e | tdEx := e].
  (captured isNil and: [tdEx notNil]) ifTrue: [captured := tdEx]].

cleanText := [:obj |
  | s |
  s := obj asString.
  s := s copyFrom: 1 to: (s size min: 4096).
  s collect: [:ch |
    (ch = Character lf or: [ch = Character cr or: [ch = Character tab]])
      ifTrue: [$ ] ifFalse: [ch]]].

ws := WriteStream on: String new.
captured isNil ifTrue: [
  ws nextPutAll: 'status: passed'; lf
] ifFalse: [
  | isFailure isMnu |
  isFailure := captured isKindOf: TestFailure.
  isMnu := captured isKindOf: MessageNotUnderstood.
  ws nextPutAll: 'status: '; nextPutAll: (isFailure ifTrue: ['failed'] ifFalse: ['error']); lf.
  ws nextPutAll: 'exceptionClass: '; nextPutAll: captured class name; lf.
  ws nextPutAll: 'errorNumber: '; nextPutAll: captured number printString; lf.
  ws nextPutAll: 'messageText: '; nextPutAll: (cleanText value: captured messageText); lf.
  ws nextPutAll: 'description: '; nextPutAll: (cleanText value: captured description); lf.
  isMnu ifTrue: [
    ws nextPutAll: 'mnuReceiver: '; nextPutAll: (cleanText value: captured receiver printString); lf.
    ws nextPutAll: 'mnuSelector: '; nextPutAll: captured selector asString; lf]].
ws contents`;

  const data = execute('describeTestFailure', code);
  return parseDetails(data);
}

// Parse "key: value" lines emitted by the Smalltalk side. Unknown keys are
// ignored so we can extend the snippet (extra fields, version-specific
// extras) without breaking existing callers.
function parseDetails(text: string): TestFailureDetails {
  const result: TestFailureDetails = { status: 'error' };
  for (const line of text.split('\n')) {
    const idx = line.indexOf(': ');
    if (idx < 0) continue;
    const key = line.substring(0, idx);
    const value = line.substring(idx + 2);
    switch (key) {
      case 'status':
        if (value === 'passed' || value === 'failed' || value === 'error') {
          result.status = value;
        }
        break;
      case 'exceptionClass':
        result.exceptionClass = value;
        break;
      case 'errorNumber': {
        const n = parseInt(value, 10);
        if (!isNaN(n)) result.errorNumber = n;
        break;
      }
      case 'messageText':
        result.messageText = value;
        break;
      case 'description':
        result.description = value;
        break;
      case 'mnuReceiver':
        result.mnuReceiver = value;
        break;
      case 'mnuSelector':
        result.mnuSelector = value;
        break;
    }
  }
  return result;
}
