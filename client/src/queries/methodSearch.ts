import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface MethodSearchResult {
  dictName: string;
  className: string;
  isMeta: boolean;
  selector: string;
  category: string;
}

// Shared Smalltalk snippet: build classDict mapping classes to their first
// dictionary name, then serialize an array of GsNMethods (bound as `methods`
// before this snippet runs) as tab-separated lines.
function methodSerialization(envId: number): string {
  return `sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
limit := methods size min: 500.
1 to: limit do: [:i |
  | each cls baseClass |
  each := methods at: i.
  cls := each inClass.
  baseClass := cls theNonMetaClass.
  stream
    nextPutAll: (classDict at: baseClass ifAbsent: ['']); tab;
    nextPutAll: baseClass name; tab;
    nextPutAll: (cls isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
    nextPutAll: each selector; tab;
    nextPutAll: ((cls categoryOfSelector: each selector environmentId: ${envId}) ifNil: ['']); lf.
].
stream contents`;
}

function parseMethodSearchResults(raw: string): MethodSearchResult[] {
  const results: MethodSearchResult[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    results.push({
      dictName: parts[0],
      className: parts[1],
      isMeta: parts[2] === '1',
      selector: parts[3],
      category: parts[4],
    });
  }
  return results;
}

export function searchMethodSource(
  execute: QueryExecutor, term: string, ignoreCase: boolean,
): MethodSearchResult[] {
  const code = `| results methods stream limit classDict sl |
results := ClassOrganizer new substringSearch: '${escapeString(term)}' ignoreCase: ${ignoreCase}.
methods := results at: 1.
${methodSerialization(0)}`;

  return parseMethodSearchResults(
    execute(`searchMethodSource('${term}')`, code),
  );
}

export function sendersOf(
  execute: QueryExecutor, selector: string, environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${environmentId}; yourself)
  sendersOf: #'${escapeString(selector)}') at: 1.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(
    execute(`sendersOf(#${selector}, env:${environmentId})`, code),
  );
}

export function implementorsOf(
  execute: QueryExecutor, selector: string, environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${environmentId}; yourself)
  implementorsOf: #'${escapeString(selector)}') asArray.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(
    execute(`implementorsOf(#${selector}, env:${environmentId})`, code),
  );
}

export function referencesToObject(
  execute: QueryExecutor, objectName: string, environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| methods stream limit classDict sl |
methods := (ClassOrganizer new referencesToObject:
  (System myUserProfile symbolList objectNamed: #'${escapeString(objectName)}')).
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(
    execute(`referencesToObject(${objectName})`, code),
  );
}
