import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL } from './gciConstants';
import { logQuery, logResult, logError, logGciCall, logGciResult } from './gciLog';

const MAX_RESULT = 256 * 1024;

// Cache resolved OOP_CLASS_Utf8 per session handle (Node.js strings are UTF-8 when passed via koffi)
const classUtf8Cache = new Map<unknown, bigint>();

export class BrowserQueryError extends Error {
  constructor(message: string, public readonly gciErrorNumber: number = 0) {
    super(message);
  }
}

function resolveClassUtf8(session: ActiveSession): bigint {
  let oop = classUtf8Cache.get(session.handle);
  if (oop !== undefined) return oop;
  const { result, err } = session.gci.GciTsResolveSymbol(session.handle, 'Utf8', OOP_NIL);
  if (err.number !== 0) {
    throw new BrowserQueryError(
      err.message || `Cannot resolve Utf8 class`, err.number
    );
  }
  oop = result;
  classUtf8Cache.set(session.handle, oop);
  return oop;
}

function executeFetchString(session: ActiveSession, label: string, code: string): string {
  logQuery(session.id, label, code);

  // Check if session is busy with an async operation (e.g., Display It)
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  logGciCall(session.id, 'GciTsExecuteFetchBytes', {
    sourceStr: code,
    sourceSize: -1,
    sourceOop: oopClassUtf8,
    contextObject: OOP_ILLEGAL,
    symbolList: OOP_NIL,
    maxResultSize: MAX_RESULT,
  });

  const { bytesReturned, data, err } = session.gci.GciTsExecuteFetchBytes(
    session.handle,
    code,
    -1,
    oopClassUtf8,
    OOP_ILLEGAL,
    OOP_NIL,
    MAX_RESULT,
  );

  logGciResult(session.id, 'GciTsExecuteFetchBytes', {
    bytesReturned,
    data,
    'err.number': err.number,
    'err.category': err.category,
    'err.context': err.context,
    'err.exceptionObj': err.exceptionObj,
    'err.args': err.args,
    'err.message': err.message,
    'err.reason': err.reason,
    'err.fatal': err.fatal,
  });

  if (err.number !== 0) {
    const msg = err.message || `GCI error ${err.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, err.number);
  }
  logResult(session.id, data);
  return data;
}

function splitLines(result: string): string[] {
  return result.split('\n').filter(s => s.length > 0);
}

function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

function receiver(className: string, isMeta: boolean): string {
  return isMeta ? `${className} class` : className;
}

export function getDictionaryNames(session: ActiveSession): string[] {
  const code = `| ws |
ws := WriteStream on: String new.
System myUserProfile symbolList names do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(executeFetchString(session, 'getDictionaryNames', code));
}

export function getClassNames(session: ActiveSession, dictName: string): string[] {
  const code = `| ws dict |
dict := System myUserProfile symbolList objectNamed: #'${escapeString(dictName)}'.
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [ws nextPutAll: k; lf]].
ws contents`;
  return splitLines(executeFetchString(session, `getClassNames(${dictName})`, code)).sort();
}

export function getMethodCategories(
  session: ActiveSession, className: string, isMeta: boolean
): string[] {
  const recv = receiver(className, isMeta);
  const code = `| ws |
ws := WriteStream on: String new.
${recv} categoryNames asSortedCollection do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(executeFetchString(session, `getMethodCategories(${recv})`, code));
}

export function getMethodSelectors(
  session: ActiveSession, className: string, isMeta: boolean, category: string
): string[] {
  const recv = receiver(className, isMeta);
  const code = `| ws |
ws := WriteStream on: String new.
(${recv} sortedSelectorsIn: '${escapeString(category)}')
  do: [:each |
    ws nextPutAll: each; lf].
ws contents`;
  return splitLines(executeFetchString(session, `getMethodSelectors(${recv}, '${category}')`, code));
}

export function getMethodSource(
  session: ActiveSession, className: string, isMeta: boolean, selector: string
): string {
  const recv = receiver(className, isMeta);
  const code = `(${recv} compiledMethodAt: #'${escapeString(selector)}') sourceString`;
  return executeFetchString(session, `getMethodSource(${recv}>>#${selector})`, code);
}

export function getClassDefinition(
  session: ActiveSession, className: string
): string {
  const code = `${className} definition`;
  return executeFetchString(session, `getClassDefinition(${className})`, code);
}

export function compileClassDefinition(
  session: ActiveSession, source: string
): void {
  // Wrap so the result is a String (the class name) — GciTsExecuteFetchBytes
  // requires a byte-object result, but class definitions return a Class.
  const code = `(${source}) name`;
  executeFetchString(session, 'compileClassDefinition', code);
}

export function getClassComment(
  session: ActiveSession, className: string
): string {
  const code = `${className} comment`;
  return executeFetchString(session, `getClassComment(${className})`, code);
}

export function setClassComment(
  session: ActiveSession, className: string, comment: string
): void {
  const code = `${className} comment: '${escapeString(comment)}'. 'ok'`;
  executeFetchString(session, `setClassComment(${className})`, code);
}

export function deleteMethod(
  session: ActiveSession, className: string, isMeta: boolean, selector: string
): void {
  const recv = receiver(className, isMeta);
  const code = `${recv} removeSelector: #'${escapeString(selector)}'. 'ok'`;
  executeFetchString(session, `deleteMethod(${recv}>>#${selector})`, code);
}

export function recategorizeMethod(
  session: ActiveSession, className: string, isMeta: boolean,
  selector: string, newCategory: string
): void {
  const recv = receiver(className, isMeta);
  const code = `${recv} moveMethod: #'${escapeString(selector)}' toCategory: '${escapeString(newCategory)}'. 'ok'`;
  executeFetchString(session, `recategorizeMethod(${recv}>>#${selector} → '${newCategory}')`, code);
}

export function renameCategory(
  session: ActiveSession, className: string, isMeta: boolean,
  oldCategory: string, newCategory: string
): void {
  const recv = receiver(className, isMeta);
  const code = `${recv} renameCategory: '${escapeString(oldCategory)}' to: '${escapeString(newCategory)}'. 'ok'`;
  executeFetchString(session, `renameCategory(${recv}, '${oldCategory}' → '${newCategory}')`, code);
}

export function deleteClass(
  session: ActiveSession, dictName: string, className: string
): void {
  const code = `(System myUserProfile symbolList objectNamed: #'${escapeString(dictName)}')
  removeKey: #'${escapeString(className)}' ifAbsent: []. 'ok'`;
  executeFetchString(session, `deleteClass(${dictName}, ${className})`, code);
}

export function moveClass(
  session: ActiveSession, srcDictName: string, destDictName: string, className: string
): void {
  const code = `| cls srcDict destDict |
srcDict := System myUserProfile symbolList objectNamed: #'${escapeString(srcDictName)}'.
destDict := System myUserProfile symbolList objectNamed: #'${escapeString(destDictName)}'.
cls := srcDict removeKey: #'${escapeString(className)}'.
destDict at: #'${escapeString(className)}' put: cls.
'ok'`;
  executeFetchString(session, `moveClass(${className}: ${srcDictName} → ${destDictName})`, code);
}

export function addDictionary(
  session: ActiveSession, dictName: string
): void {
  const code = `| dict |
dict := SymbolDictionary new.
dict name: #'${escapeString(dictName)}'.
System myUserProfile symbolList add: dict.
dict name`;
  executeFetchString(session, `addDictionary(${dictName})`, code);
}

export function moveDictionaryUp(
  session: ActiveSession, dictName: string
): void {
  const code = `| sl idx temp |
sl := System myUserProfile symbolList.
idx := sl names indexOf: #'${escapeString(dictName)}'.
idx > 1 ifTrue: [
  temp := sl at: idx.
  sl at: idx put: (sl at: idx - 1).
  sl at: idx - 1 put: temp].
'ok'`;
  executeFetchString(session, `moveDictionaryUp(${dictName})`, code);
}

export function moveDictionaryDown(
  session: ActiveSession, dictName: string
): void {
  const code = `| sl idx temp |
sl := System myUserProfile symbolList.
idx := sl names indexOf: #'${escapeString(dictName)}'.
idx < sl size ifTrue: [
  temp := sl at: idx.
  sl at: idx put: (sl at: idx + 1).
  sl at: idx + 1 put: temp].
'ok'`;
  executeFetchString(session, `moveDictionaryDown(${dictName})`, code);
}

export function compileMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  category: string,
  source: string,
): bigint {
  const recv = receiver(className, isMeta);
  logQuery(session.id, `compileMethod(${recv}, '${category}')`, source);

  // Resolve the base class OOP
  const { result: baseClassOop, err: resolveErr } = session.gci.GciTsResolveSymbol(
    session.handle, className, OOP_NIL,
  );
  if (resolveErr.number !== 0) {
    throw new BrowserQueryError(
      resolveErr.message || `Cannot resolve ${className}`, resolveErr.number
    );
  }

  // For class side, send #class to get the metaclass OOP
  let classOop = baseClassOop;
  if (isMeta) {
    const { result: metaOop, err: metaErr } = session.gci.GciTsPerform(
      session.handle, baseClassOop, OOP_ILLEGAL, 'class', [], 0, 0,
    );
    if (metaErr.number !== 0) {
      throw new BrowserQueryError(
        metaErr.message || `Cannot get metaclass for ${className}`, metaErr.number
      );
    }
    classOop = metaOop;
  }

  // Create source String OOP
  const { result: sourceOop, err: srcErr } = session.gci.GciTsNewString(
    session.handle, source,
  );
  if (srcErr.number !== 0) {
    throw new BrowserQueryError(
      srcErr.message || 'Cannot create source string', srcErr.number
    );
  }

  // Create category Symbol OOP
  const { result: catOop, err: catErr } = session.gci.GciTsNewSymbol(
    session.handle, category,
  );
  if (catErr.number !== 0) {
    throw new BrowserQueryError(
      catErr.message || 'Cannot create category symbol', catErr.number
    );
  }

  // Compile the method
  const { result: methodOop, err: compileErr } = session.gci.GciTsCompileMethod(
    session.handle,
    sourceOop,
    classOop,
    catOop,
    OOP_NIL,       // symbolList (use default)
    OOP_NIL,       // overrideSelector
    0,             // compileFlags
    0,             // environmentId
  );
  if (compileErr.number !== 0) {
    if (compileErr.context !== OOP_NIL && compileErr.context !== 0n) {
      try { session.gci.GciTsClearStack(session.handle, compileErr.context); } catch { /* ignore */ }
    }
    const msg = compileErr.message || `Compile error ${compileErr.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, compileErr.number);
  }

  logResult(session.id, `Compiled → OOP ${methodOop}`);
  return methodOop;
}
