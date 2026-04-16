import { QueryExecutor } from './types';
import { splitLines } from './util';

export interface TestClassInfo {
  dictName: string;
  className: string;
}

export function discoverTestClasses(execute: QueryExecutor): TestClassInfo[] {
  const code = `| ws sl classDict |
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(classDict includesKey: v) not]]])
        ifTrue: [classDict at: v put: dict name]]].
ws := WriteStream on: Unicode7 new.
classDict keysAndValuesDo: [:cls :dictName |
  ws nextPutAll: dictName; tab; nextPutAll: cls name; lf].
ws contents`;
  const data = execute('discoverTestClasses', code);
  return splitLines(data).map(line => {
    const [dictName, className] = line.split('\t');
    return { dictName, className };
  });
}
