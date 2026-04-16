import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface EnvCategoryLine {
  isMeta: boolean;
  envId: number;
  category: string;
  selectors: string[];
}

export function getClassEnvironments(
  execute: QueryExecutor, dictIndex: number, className: string, maxEnv: number,
): EnvCategoryLine[] {
  const code = `| class envs stream |
envs := ${maxEnv}.
class := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
stream := WriteStream on: Unicode7 new.
{ class class. class. } do: [:eachClass |
  0 to: envs do: [:env |
    (eachClass _unifiedCategorys: env) keysAndValuesDo: [:categoryName :selectors |
      stream
        nextPutAll: eachClass name; tab;
        nextPutAll: env printString; tab;
        nextPutAll: categoryName; tab;
        yourself.
      selectors do: [:each |
        stream nextPutAll: each; tab.
      ].
      stream lf.
    ].
  ].
].
stream contents`;

  const raw = execute(`getClassEnvironments(${className}, ${maxEnv})`, code);

  const results: EnvCategoryLine[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t').filter(s => s.length > 0);
    if (parts.length < 3) continue;
    const receiverName = parts[0];
    const envId = parseInt(parts[1], 10);
    const category = parts[2];
    const selectors = parts.slice(3).sort();
    const isMeta = receiverName.endsWith(' class');
    results.push({ isMeta, envId, category, selectors });
  }
  return results;
}
