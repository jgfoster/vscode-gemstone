import { QueryExecutor } from './types';
import { escapeString } from './util';

export function getSuperclassDictName(
  execute: QueryExecutor, dictIndex: number, className: string,
): string {
  const code = `| cls sc result |
cls := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
sc := cls superclass.
sc isNil ifTrue: [''].
sc ifNotNil: [
  result := ''.
  System myUserProfile symbolList do: [:d |
    (d includesKey: sc name asSymbol) ifTrue: [result := d name]].
  result]`;
  return execute(`getSuperclassDictName(${className})`, code).trim();
}
