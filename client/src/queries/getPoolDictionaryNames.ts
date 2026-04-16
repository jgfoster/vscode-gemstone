import { QueryExecutor } from './types';
import { splitLines } from './util';

export function getPoolDictionaryNames(execute: QueryExecutor): string[] {
  const code = `| ws names |
names := IdentitySet new.
System myUserProfile symbolList do: [:dict |
  dict keysAndValuesDo: [:key :val |
    (val isKindOf: SymbolDictionary) ifTrue: [names add: key]]].
ws := WriteStream on: String new.
names asSortedCollection do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute('getPoolDictionaryNames', code));
}
