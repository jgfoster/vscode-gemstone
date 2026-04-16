import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface ClassInfo {
  definition: string;
  superclassDictName: string;
  comment: string;
  canBeWritten: boolean;
}

// Combined query that fetches definition, superclass dict name, comment, and
// canBeWritten in a single GemStone round trip. Purpose-built for the class
// browser panel which needs all four fields when loading a class.
export function loadClassInfo(
  execute: QueryExecutor, dictIndex: number, className: string,
): ClassInfo {
  const esc = escapeString(className);
  const code = `| cls scDictName comment canEdit ws |
cls := (System myUserProfile symbolList at: ${dictIndex}) at: #'${esc}'.
scDictName := ''.
cls superclass ifNotNil: [:sc |
  System myUserProfile symbolList do: [:d |
    (d includesKey: sc name asSymbol) ifTrue: [scDictName := d name]]].
comment := [cls comment ifNil: ['']] on: Error do: [:e | ''].
canEdit := [cls canBeWritten] on: Error do: [:e | false].
ws := WriteStream on: Unicode7 new.
ws nextPutAll: scDictName; tab;
   nextPutAll: (canEdit ifTrue: ['true'] ifFalse: ['false']); lf.
ws nextPutAll: cls definition; lf.
ws nextPutAll: '===COMMENT==='; lf.
ws nextPutAll: comment.
ws contents`;
  const raw = execute(`loadClassInfo(${className}, dict: ${dictIndex})`, code);

  const firstNewline = raw.indexOf('\n');
  const headerLine = raw.substring(0, firstNewline);
  const [superclassDictName, canBeWrittenStr] = headerLine.split('\t');
  const rest = raw.substring(firstNewline + 1);
  const commentMarker = '\n===COMMENT===\n';
  const markerIdx = rest.indexOf(commentMarker);
  const definition = markerIdx >= 0 ? rest.substring(0, markerIdx) : rest;
  const comment = markerIdx >= 0 ? rest.substring(markerIdx + commentMarker.length) : '';

  return {
    definition,
    superclassDictName: superclassDictName || '',
    comment,
    canBeWritten: canBeWrittenStr === 'true',
  };
}
