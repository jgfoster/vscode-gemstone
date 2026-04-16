import { QueryExecutor } from './types';

export interface ClassNameEntry {
  dictIndex: number;
  dictName: string;
  className: string;
}

export function getAllClassNames(execute: QueryExecutor): ClassNameEntry[] {
  const code = `| ws sl seen |
ws := WriteStream on: Unicode7 new.
sl := System myUserProfile symbolList.
seen := IdentitySet new.
1 to: sl size do: [:idx |
  | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(seen includes: v) not]) ifTrue: [
      seen add: v.
      ws nextPutAll: idx printString; tab; nextPutAll: dict name; tab; nextPutAll: k; lf]]].
ws contents`;

  const raw = execute('getAllClassNames', code);
  const results: ClassNameEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      dictIndex: parseInt(parts[0], 10),
      dictName: parts[1],
      className: parts[2],
    });
  }
  return results;
}
