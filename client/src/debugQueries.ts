import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL, GCI_PERFORM_FLAG_ENABLE_DEBUG } from './gciConstants';
import { logInfo, logError } from './gciLog';

const MAX_RESULT = 256 * 1024;

// ── Helpers ─────────────────────────────────────────────

function gciPerform(
  session: ActiveSession, receiver: bigint, selector: string, args: bigint[] = [],
): bigint {
  const { result, err } = session.gci.GciTsPerform(
    session.handle, receiver, OOP_ILLEGAL, selector, args, 0, 0,
  );
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
  }
  return result;
}

function gciPerformFetchString(
  session: ActiveSession, receiver: bigint, selector: string, args: bigint[] = [],
): string {
  const { data, err } = session.gci.GciTsPerformFetchBytes(
    session.handle, receiver, selector, args, MAX_RESULT,
  );
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in ${selector}`);
  }
  return data;
}

function oopToInt(session: ActiveSession, oop: bigint): number {
  const { value, err } = session.gci.GciTsOopToI64(session.handle, oop);
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in OopToI64`);
  }
  return Number(value);
}

function intToOop(session: ActiveSession, n: number): bigint {
  const { result, err } = session.gci.GciTsI64ToOop(session.handle, BigInt(n));
  if (err.number !== 0) {
    throw new Error(err.message || `GCI error ${err.number} in I64ToOop`);
  }
  return result;
}

// ── Frame info ──────────────────────────────────────────

export interface FrameInfo {
  methodOop: bigint;
  ipOffset: number;
  receiverOop: bigint;
  argAndTempNames: string[];
  argAndTempOops: bigint[];
}

export interface MethodInfo {
  className: string;
  selector: string;
}

/**
 * Returns the number of stack frames in the suspended process.
 */
export function getStackDepth(session: ActiveSession, gsProcess: bigint): number {
  const oop = gciPerform(session, gsProcess, 'localStackDepth');
  return oopToInt(session, oop);
}

/**
 * Returns frame details at the given level (1-based, 1 = top).
 *
 * GsProcess>>_frameContentsAt: returns an Array:
 *   [1] method (GsNMethod)
 *   [2] ipOffset (SmallInteger)
 *   [3..7] internal details
 *   [8] self
 *   [9] argAndTempNames (Array of Strings)
 *   [10] receiver
 *   [11..] arg and temp values
 */
export function getFrameInfo(
  session: ActiveSession, gsProcess: bigint, level: number,
): FrameInfo {
  const levelOop = intToOop(session, level);
  const arrayOop = gciPerform(session, gsProcess, '_frameContentsAt:', [levelOop]);

  // Fetch the size of the returned array
  const { result: sizeRaw, err: sizeErr } = session.gci.GciTsFetchSize(session.handle, arrayOop);
  if (sizeErr.number !== 0) {
    throw new Error(sizeErr.message || `Cannot fetch array size`);
  }
  const size = Number(sizeRaw);

  // Fetch all OOPs from the array (1-based indexing in GemStone, 0-based in GciTsFetchOops)
  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(
    session.handle, arrayOop, 1n, size,
  );
  if (fetchErr.number !== 0) {
    throw new Error(fetchErr.message || `Cannot fetch frame contents`);
  }

  const methodOop = oops[0];     // [1] method
  const ipOffsetOop = oops[1];   // [2] ipOffset
  const receiverOop = oops[9];   // [10] receiver (0-indexed: 9)
  const namesArrayOop = oops[8]; // [9] argAndTempNames (0-indexed: 8)

  const ipOffset = oopToInt(session, ipOffsetOop);

  // Fetch arg and temp names from the names array
  const argAndTempNames: string[] = [];
  if (namesArrayOop !== OOP_NIL) {
    const { result: namesSizeRaw } = session.gci.GciTsFetchSize(
      session.handle, namesArrayOop,
    );
    const namesSize = Number(namesSizeRaw);
    if (namesSize > 0) {
      const { oops: nameOops } = session.gci.GciTsFetchOops(
        session.handle, namesArrayOop, 1n, namesSize,
      );
      for (const nameOop of nameOops) {
        const name = gciPerformFetchString(session, nameOop, 'asString');
        argAndTempNames.push(name);
      }
    }
  }

  // Arg and temp values start at index 10 (0-indexed) = Smalltalk index 11
  const argAndTempOops = oops.slice(10);

  return { methodOop, ipOffset, receiverOop, argAndTempNames, argAndTempOops };
}

/**
 * Returns class name and selector for a method OOP.
 */
export function getMethodInfo(session: ActiveSession, methodOop: bigint): MethodInfo {
  const classOop = gciPerform(session, methodOop, 'inClass');
  const className = gciPerformFetchString(session, classOop, 'name');
  const selector = gciPerformFetchString(session, methodOop, 'selector');
  return { className, selector };
}

/**
 * Returns the source code of a method.
 */
export function getMethodSource(session: ActiveSession, methodOop: bigint): string {
  return gciPerformFetchString(session, methodOop, 'sourceString');
}

/**
 * Maps an IP offset to a source line number.
 */
export function getLineForIp(
  session: ActiveSession, methodOop: bigint, ipOffset: number,
): number {
  const ipOop = intToOop(session, ipOffset);
  const lineOop = gciPerform(session, methodOop, '_lineNumberForIp:', [ipOop]);
  return oopToInt(session, lineOop);
}

// ── Variables ───────────────────────────────────────────

/**
 * Returns a printString representation of an object (truncated to maxBytes).
 */
export function getObjectPrintString(
  session: ActiveSession, oop: bigint, maxBytes: number = 1024,
): string {
  try {
    const { data, err } = session.gci.GciTsPerformFetchBytes(
      session.handle, oop, 'printString', [], maxBytes,
    );
    if (err.number !== 0) return `<error: ${err.message}>`;
    return data;
  } catch {
    return '<error getting printString>';
  }
}

/**
 * Returns the class name of an object.
 */
export function getObjectClassName(session: ActiveSession, oop: bigint): string {
  try {
    const classOop = gciPerform(session, oop, 'class');
    return gciPerformFetchString(session, classOop, 'name');
  } catch {
    return '<Unknown>';
  }
}

/**
 * Returns true if the OOP is a special (immediate) value — SmallInteger, Character, etc.
 */
export function isSpecialOop(session: ActiveSession, oop: bigint): boolean {
  return session.gci.GciTsOopIsSpecial(oop);
}

/**
 * Returns named instvar names for an object's class.
 */
export function getInstVarNames(session: ActiveSession, oop: bigint): string[] {
  const classOop = gciPerform(session, oop, 'class');
  const namesArrayOop = gciPerform(session, classOop, 'allInstVarNames');
  const { result: sizeRaw } = session.gci.GciTsFetchSize(session.handle, namesArrayOop);
  const size = Number(sizeRaw);
  const names: string[] = [];
  if (size > 0) {
    const { oops } = session.gci.GciTsFetchOops(session.handle, namesArrayOop, 1n, size);
    for (const nameOop of oops) {
      names.push(gciPerformFetchString(session, nameOop, 'asString'));
    }
  }
  return names;
}

/**
 * Fetches OOPs of named instance variables.
 */
export function getNamedInstVarOops(
  session: ActiveSession, oop: bigint, count: number,
): bigint[] {
  if (count <= 0) return [];
  const { oops, err } = session.gci.GciTsFetchNamedOops(
    session.handle, oop, 1n, count,
  );
  if (err.number !== 0) return [];
  return oops;
}

/**
 * Returns the varying (indexed) size of an object.
 */
export function getIndexedSize(session: ActiveSession, oop: bigint): number {
  const { result, err } = session.gci.GciTsFetchVaryingSize(session.handle, oop);
  if (err.number !== 0) return 0;
  return Number(result);
}

/**
 * Fetches OOPs of varying (indexed) elements.
 */
export function getIndexedOops(
  session: ActiveSession, oop: bigint, startIndex: number, count: number,
): bigint[] {
  if (count <= 0) return [];
  const { oops, err } = session.gci.GciTsFetchVaryingOops(
    session.handle, oop, BigInt(startIndex), count,
  );
  if (err.number !== 0) return [];
  return oops;
}

// ── Stepping ────────────────────────────────────────────

/**
 * Sends a step message (e.g. gciStepOverFromLevel:) to the GsProcess
 * via blocking GciTsPerform. The step message both configures and
 * executes the step — it blocks until the process stops at the next
 * step point, breakpoint, or error.
 */
function performStep(
  session: ActiveSession, gsProcess: bigint, selector: string, args: bigint[],
): { completed: boolean; errorMessage?: string; errorContext?: bigint } {
  const { err } = session.gci.GciTsPerform(
    session.handle, gsProcess, OOP_ILLEGAL, selector, args,
    GCI_PERFORM_FLAG_ENABLE_DEBUG, 0,
  );
  if (err.number !== 0) {
    return {
      completed: false,
      errorMessage: err.message || `GemStone error ${err.number}`,
      errorContext: err.context,
    };
  }
  return { completed: true };
}

export function stepOver(
  session: ActiveSession, gsProcess: bigint, level: number,
): { completed: boolean; errorMessage?: string; errorContext?: bigint } {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepOver from level ${level}`);
  return performStep(session, gsProcess, 'gciStepOverFromLevel:', [levelOop]);
}

export function stepInto(
  session: ActiveSession, gsProcess: bigint, level: number,
): { completed: boolean; errorMessage?: string; errorContext?: bigint } {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepInto from level ${level}`);
  return performStep(session, gsProcess, 'gciStepIntoFromLevel:', [levelOop]);
}

export function stepOut(
  session: ActiveSession, gsProcess: bigint, level: number,
): { completed: boolean; errorMessage?: string; errorContext?: bigint } {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: stepThru from level ${level}`);
  return performStep(session, gsProcess, 'gciStepThruFromLevel:', [levelOop]);
}

// ── Continue / Terminate ────────────────────────────────

/**
 * Continues execution of a suspended process. This is blocking in GCI,
 * so we use it synchronously (the caller should handle UI responsiveness).
 *
 * Returns true if execution completed normally, false if it hit another error.
 */
export function continueExecution(
  session: ActiveSession, gsProcess: bigint,
): { completed: boolean; errorMessage?: string; errorContext?: bigint } {
  logInfo(`[Session ${session.id}] Debug: continue`);
  const { err } = session.gci.GciTsContinueWith(
    session.handle, gsProcess, OOP_NIL, null, GCI_PERFORM_FLAG_ENABLE_DEBUG,
  );
  if (err.number !== 0) {
    return {
      completed: false,
      errorMessage: err.message || `GemStone error ${err.number}`,
      errorContext: err.context,
    };
  }
  return { completed: true };
}

/**
 * Clears the stack of a suspended process (aborts it).
 */
export function clearStack(session: ActiveSession, gsProcess: bigint): void {
  logInfo(`[Session ${session.id}] Debug: clearStack`);
  try {
    session.gci.GciTsClearStack(session.handle, gsProcess);
  } catch {
    // Ignore — process may already be gone
  }
}

/**
 * Trims the stack to just below the given level (for restart frame / edit-and-continue).
 */
export function trimStackToLevel(
  session: ActiveSession, gsProcess: bigint, level: number,
): void {
  const levelOop = intToOop(session, level);
  logInfo(`[Session ${session.id}] Debug: trimStackToLevel ${level}`);
  gciPerform(session, gsProcess, 'trimStackToLevel:', [levelOop]);
}

// ── Evaluate ────────────────────────────────────────────

/**
 * Evaluates an expression in the context of a stack frame.
 * Returns the printString of the result.
 */
export function evaluateInFrame(
  session: ActiveSession, gsProcess: bigint, expression: string, level: number,
): string {
  // Create a String object for the expression
  const { result: exprOop, err: strErr } = session.gci.GciTsNewString(
    session.handle, expression,
  );
  if (strErr.number !== 0) {
    throw new Error(strErr.message || 'Cannot create expression string');
  }

  // Create an empty Array for args
  const { result: argsOop, err: arrErr } = session.gci.GciTsResolveSymbol(
    session.handle, 'Array', OOP_NIL,
  );
  if (arrErr.number !== 0) {
    throw new Error(arrErr.message || 'Cannot resolve Array class');
  }
  const emptyArray = gciPerform(session, argsOop, 'new');

  const levelOop = intToOop(session, level);

  // Send: gsProcess _framePerform: expression withArgs: #() onLevel: level
  const resultOop = gciPerform(
    session, gsProcess, '_framePerform:withArgs:onLevel:',
    [exprOop, emptyArray, levelOop],
  );

  // Get printString of the result
  return getObjectPrintString(session, resultOop);
}
