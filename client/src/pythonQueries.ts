import { ActiveSession } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { QueryExecutor } from './queries/types';

import { evalPython as sharedEvalPython, compilePython as sharedCompilePython } from './queries/python';

function bind(session: ActiveSession): QueryExecutor {
  return (label, code) => executeFetchString(session, label, code);
}

export function evalPython(session: ActiveSession, source: string) {
  return sharedEvalPython(bind(session), source);
}

export function compilePython(session: ActiveSession, source: string) {
  return sharedCompilePython(bind(session), source);
}
