import { ActiveSession } from './sessionManager';
import { OOP_NIL, OOP_ILLEGAL } from './gciConstants';
import { logQuery, logResult, logError, logGciCall, logGciResult } from './gciLog';

import { QueryExecutor } from './queries/types';

// Read-path shared queries.
import { getMethodSource as sharedGetMethodSource } from './queries/getMethodSource';
import { getDictionaryNames as sharedGetDictionaryNames } from './queries/getDictionaryNames';
import { getPoolDictionaryNames as sharedGetPoolDictionaryNames } from './queries/getPoolDictionaryNames';
import { getClassNames as sharedGetClassNames } from './queries/getClassNames';
import { getDictionaryEntries as sharedGetDictionaryEntries } from './queries/getDictionaryEntries';
import { getGlobalsForDictionary as sharedGetGlobalsForDictionary } from './queries/getGlobalsForDictionary';
import { getMethodCategories as sharedGetMethodCategories } from './queries/getMethodCategories';
import { getMethodSelectors as sharedGetMethodSelectors } from './queries/getMethodSelectors';
import { getClassEnvironments as sharedGetClassEnvironments } from './queries/getClassEnvironments';
import { getClassDefinition as sharedGetClassDefinition } from './queries/getClassDefinition';
import { getClassComment as sharedGetClassComment } from './queries/getClassComment';
import { getSuperclassDictName as sharedGetSuperclassDictName } from './queries/getSuperclassDictName';
import { canClassBeWritten as sharedCanClassBeWritten } from './queries/canClassBeWritten';
import { getAllClassNames as sharedGetAllClassNames } from './queries/getAllClassNames';
import { getClassHierarchy as sharedGetClassHierarchy } from './queries/getClassHierarchy';
import { fileOutClass as sharedFileOutClass } from './queries/fileOutClass';
import { describeClass as sharedDescribeClass } from './queries/describeClass';
import { loadClassInfo as sharedLoadClassInfo } from './queries/loadClassInfo';
import { getInstVarNames as sharedGetInstVarNames } from './queries/getInstVarNames';
import { getAllSelectors as sharedGetAllSelectors } from './queries/getAllSelectors';
import { getMethodList as sharedGetMethodList } from './queries/getMethodList';
import { getSourceOffsets as sharedGetSourceOffsets } from './queries/getSourceOffsets';
import { getStepPointSelectorRanges as sharedGetStepPointSelectorRanges } from './queries/getStepPointSelectorRanges';
import {
  searchMethodSource as sharedSearchMethodSource,
  sendersOf as sharedSendersOf,
  implementorsOf as sharedImplementorsOf,
  referencesToObject as sharedReferencesToObject,
} from './queries/methodSearch';

// Write-path shared queries.
import { compileMethod as sharedCompileMethod } from './queries/compileMethod';
import { compileClassDefinition as sharedCompileClassDefinition } from './queries/compileClassDefinition';
import { setClassComment as sharedSetClassComment } from './queries/setClassComment';
import { deleteMethod as sharedDeleteMethod } from './queries/deleteMethod';
import { recategorizeMethod as sharedRecategorizeMethod } from './queries/recategorizeMethod';
import { renameCategory as sharedRenameCategory } from './queries/renameCategory';
import { deleteClass as sharedDeleteClass } from './queries/deleteClass';
import { moveClass as sharedMoveClass } from './queries/moveClass';
import { reclassifyClass as sharedReclassifyClass } from './queries/reclassifyClass';
import { addDictionary as sharedAddDictionary } from './queries/addDictionary';
import { removeDictionary as sharedRemoveDictionary } from './queries/removeDictionary';
import { moveDictionaryUp as sharedMoveDictionaryUp } from './queries/moveDictionaryUp';
import { moveDictionaryDown as sharedMoveDictionaryDown } from './queries/moveDictionaryDown';
import { setBreakAtStepPoint as sharedSetBreakAtStepPoint } from './queries/setBreakAtStepPoint';
import { clearBreakAtStepPoint as sharedClearBreakAtStepPoint } from './queries/clearBreakAtStepPoint';
import { clearAllBreaks as sharedClearAllBreaks } from './queries/clearAllBreaks';

// Re-export shared types so existing callers (extension.ts, systemBrowser.ts, etc.)
// can continue to import them from './browserQueries'.
export type { DictEntry } from './queries/getDictionaryEntries';
export type { GlobalEntry } from './queries/getGlobalsForDictionary';
export type { ClassNameEntry } from './queries/getAllClassNames';
export type { EnvCategoryLine } from './queries/getClassEnvironments';
export type { ClassHierarchyEntry } from './queries/getClassHierarchy';
export type { MethodEntry } from './queries/getMethodList';
export type { StepPointSelectorInfo } from './queries/getStepPointSelectorRanges';
export type { MethodSearchResult } from './queries/methodSearch';
export type { ClassInfo } from './queries/loadClassInfo';

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

export function executeFetchString(session: ActiveSession, label: string, code: string): string {
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

// Bind a session to the QueryExecutor shape that shared queries expect.
function bind(session: ActiveSession): QueryExecutor {
  return (label, code) => executeFetchString(session, label, code);
}

// ── Read-only queries (thin delegates to client/src/queries/) ─────────────

export function getDictionaryNames(session: ActiveSession): string[] {
  return sharedGetDictionaryNames(bind(session));
}

export function getPoolDictionaryNames(session: ActiveSession): string[] {
  return sharedGetPoolDictionaryNames(bind(session));
}

export function getClassNames(
  session: ActiveSession, dict: number | string,
): string[] {
  return sharedGetClassNames(bind(session), dict);
}

export function getDictionaryEntries(
  session: ActiveSession, dict: number | string,
) {
  return sharedGetDictionaryEntries(bind(session), dict);
}

export function getGlobalsForDictionary(session: ActiveSession, dictIndex: number) {
  return sharedGetGlobalsForDictionary(bind(session), dictIndex);
}

export function getMethodCategories(
  session: ActiveSession, className: string, isMeta: boolean,
): string[] {
  return sharedGetMethodCategories(bind(session), className, isMeta);
}

export function getMethodSelectors(
  session: ActiveSession, className: string, isMeta: boolean, category: string,
): string[] {
  return sharedGetMethodSelectors(bind(session), className, isMeta, category);
}

export function getClassEnvironments(
  session: ActiveSession, dictIndex: number, className: string, maxEnv: number,
) {
  return sharedGetClassEnvironments(bind(session), dictIndex, className, maxEnv);
}

export function getMethodSource(
  session: ActiveSession, className: string, isMeta: boolean, selector: string,
  environmentId: number = 0,
): string {
  return sharedGetMethodSource(bind(session), className, isMeta, selector, environmentId);
}

export function getClassDefinition(session: ActiveSession, className: string): string {
  return sharedGetClassDefinition(bind(session), className);
}

export function getClassComment(session: ActiveSession, className: string): string {
  return sharedGetClassComment(bind(session), className);
}

export function getSuperclassDictName(
  session: ActiveSession, dictIndex: number, className: string,
): string {
  return sharedGetSuperclassDictName(bind(session), dictIndex, className);
}

export function canClassBeWritten(session: ActiveSession, className: string): boolean {
  return sharedCanClassBeWritten(bind(session), className);
}

export function getAllClassNames(session: ActiveSession) {
  return sharedGetAllClassNames(bind(session));
}

export function getClassHierarchy(session: ActiveSession, className: string) {
  return sharedGetClassHierarchy(bind(session), className);
}

export function fileOutClass(
  session: ActiveSession, className: string, dict?: number | string,
): string {
  return sharedFileOutClass(bind(session), className, dict);
}

export function loadClassInfo(
  session: ActiveSession, dictIndex: number, className: string,
) {
  return sharedLoadClassInfo(bind(session), dictIndex, className);
}

export function describeClass(
  session: ActiveSession, className: string, dict?: number | string,
): string {
  return sharedDescribeClass(bind(session), className, dict);
}

export function getInstVarNames(session: ActiveSession, className: string): string[] {
  return sharedGetInstVarNames(bind(session), className);
}

export function getAllSelectors(session: ActiveSession, className: string): string[] {
  return sharedGetAllSelectors(bind(session), className);
}

export function getMethodList(session: ActiveSession, className: string) {
  return sharedGetMethodList(bind(session), className);
}

export function getSourceOffsets(
  session: ActiveSession,
  className: string, isMeta: boolean, selector: string, environmentId: number = 0,
): number[] {
  return sharedGetSourceOffsets(bind(session), className, isMeta, selector, environmentId);
}

export function getStepPointSelectorRanges(
  session: ActiveSession,
  className: string, isMeta: boolean, selector: string, environmentId: number = 0,
) {
  return sharedGetStepPointSelectorRanges(bind(session), className, isMeta, selector, environmentId);
}

export function searchMethodSource(
  session: ActiveSession, term: string, ignoreCase: boolean,
) {
  return sharedSearchMethodSource(bind(session), term, ignoreCase);
}

export function sendersOf(
  session: ActiveSession, selector: string, environmentId: number = 0,
) {
  return sharedSendersOf(bind(session), selector, environmentId);
}

export function implementorsOf(
  session: ActiveSession, selector: string, environmentId: number = 0,
) {
  return sharedImplementorsOf(bind(session), selector, environmentId);
}

export function referencesToObject(
  session: ActiveSession, objectName: string, environmentId: number = 0,
) {
  return sharedReferencesToObject(bind(session), objectName, environmentId);
}

// ── Write-path queries (mutations) ─────────────────────────────────────────
// All of these delegate to the shared layer. None auto-commit.

export function compileClassDefinition(
  session: ActiveSession, source: string,
): string {
  return sharedCompileClassDefinition(bind(session), source);
}

export function compileMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  category: string,
  source: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedCompileMethod(
    bind(session), className, isMeta, category, source, environmentId, dict,
  );
}

export function setClassComment(
  session: ActiveSession, className: string, comment: string, dict?: number | string,
): string {
  return sharedSetClassComment(bind(session), className, comment, dict);
}

export function deleteMethod(
  session: ActiveSession, className: string, isMeta: boolean, selector: string,
  dict?: number | string,
): string {
  return sharedDeleteMethod(bind(session), className, isMeta, selector, dict);
}

export function recategorizeMethod(
  session: ActiveSession, className: string, isMeta: boolean,
  selector: string, newCategory: string,
): string {
  return sharedRecategorizeMethod(bind(session), className, isMeta, selector, newCategory);
}

export function renameCategory(
  session: ActiveSession, className: string, isMeta: boolean,
  oldCategory: string, newCategory: string,
): string {
  return sharedRenameCategory(bind(session), className, isMeta, oldCategory, newCategory);
}

export function deleteClass(
  session: ActiveSession, dict: number | string, className: string,
): string {
  return sharedDeleteClass(bind(session), dict, className);
}

export function moveClass(
  session: ActiveSession, srcDictIndex: number, destDictIndex: number, className: string,
): string {
  return sharedMoveClass(bind(session), srcDictIndex, destDictIndex, className);
}

export function reclassifyClass(
  session: ActiveSession, dictIndex: number, className: string, newCategory: string,
): string {
  return sharedReclassifyClass(bind(session), dictIndex, className, newCategory);
}

export function addDictionary(session: ActiveSession, dictName: string): string {
  return sharedAddDictionary(bind(session), dictName);
}

export function removeDictionary(
  session: ActiveSession, dict: number | string,
): string {
  return sharedRemoveDictionary(bind(session), dict);
}

export function moveDictionaryUp(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryUp(bind(session), dictIndex);
}

export function moveDictionaryDown(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryDown(bind(session), dictIndex);
}

export function setBreakAtStepPoint(
  session: ActiveSession,
  className: string, isMeta: boolean, selector: string,
  stepPoint: number, environmentId: number = 0,
): string {
  return sharedSetBreakAtStepPoint(
    bind(session), className, isMeta, selector, stepPoint, environmentId,
  );
}

export function clearBreakAtStepPoint(
  session: ActiveSession,
  className: string, isMeta: boolean, selector: string,
  stepPoint: number, environmentId: number = 0,
): string {
  return sharedClearBreakAtStepPoint(
    bind(session), className, isMeta, selector, stepPoint, environmentId,
  );
}

export function clearAllBreaks(
  session: ActiveSession,
  className: string, isMeta: boolean, selector: string, environmentId: number = 0,
): string {
  return sharedClearAllBreaks(
    bind(session), className, isMeta, selector, environmentId,
  );
}
