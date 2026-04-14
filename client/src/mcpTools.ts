import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';

/**
 * Register the Jasper MCP tools against the user's currently selected
 * GemStone session. The session is resolved on each invocation via the
 * provided callback, so switching the active session in the UI is reflected
 * immediately.
 *
 * If no session is selected (or the user has not logged in), tools return an
 * error response rather than throwing — Claude can handle that gracefully and
 * tell the user to log in.
 */
export function registerMcpTools(
  server: McpServer,
  getSession: () => ActiveSession | undefined,
): void {

  function requireSession(): ActiveSession | { errorText: string } {
    const session = getSession();
    if (!session) {
      return {
        errorText:
          'No active GemStone session. Select a session in Jasper (Sessions pane) ' +
          'or log in to a database before calling this tool.',
      };
    }
    return session;
  }

  function wrap<T extends Record<string, unknown>>(
    fn: (session: ActiveSession, args: T) => string,
  ): (args: T) => { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    return (args: T) => {
      const s = requireSession();
      if ('errorText' in s) {
        return { content: [{ type: 'text', text: s.errorText }], isError: true };
      }
      try {
        const text = fn(s, args);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    };
  }

  // Tools are registered alphabetically.

  server.tool(
    'abort',
    'Abort the current transaction on the user\'s active session, discarding uncommitted changes.',
    {},
    async () => wrap<Record<string, unknown>>((session) => {
      const out = executeString(session, `System abortTransaction. 'Transaction aborted'`);
      return out;
    })({}),
  );

  server.tool(
    'commit',
    'Commit the user\'s active session transaction, persisting all changes.',
    {},
    async () => wrap<Record<string, unknown>>((session) => {
      return executeString(session, `System commitTransaction
  ifTrue: ['Transaction committed']
  ifFalse: ['Commit failed — possible conflict. Use abort to reset, then retry.']`);
    })({}),
  );

  server.tool(
    'compile_method',
    'Compile (add or update) a method on a class in the user\'s active session. Not committed automatically.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      category: z.string().describe('Method category, e.g. "accessing"'),
      source: z.string().describe('Full method source including the selector line'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      const recv = a.isMeta ? `${a.className} class` : a.className;
      const envId = a.environmentId ?? 0;
      const code = `${recv}
  compileMethod: '${escapeString(a.source)}'
  dictionaries: System myUserProfile symbolList
  category: '${escapeString(a.category)}'
  environmentId: ${envId}.
'Compiled successfully: ${escapeString(recv)} >> ' , (('${escapeString(a.source)}' copyUpTo: Character lf) copyUpTo: Character cr)`;
      return executeString(session, code);
    })(args),
  );

  server.tool(
    'execute_code',
    'Execute GemStone Smalltalk code in the user\'s active session and return the result as a string (printString). Changes are NOT committed automatically.',
    { code: z.string().describe('Smalltalk expression to execute') },
    async (args) => wrap<typeof args>((session, a) => {
      return executeString(session, `(${a.code}) printString`);
    })(args),
  );

  server.tool(
    'find_implementors',
    'Find all classes that implement a given selector. Returns up to 500 results.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      const results = queries.implementorsOf(session, a.selector, a.environmentId ?? 0);
      return formatMethodResults(results, 'No implementors found.');
    })(args),
  );

  server.tool(
    'find_senders',
    'Find all methods that send a given selector. Returns up to 500 results.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      const results = queries.sendersOf(session, a.selector, a.environmentId ?? 0);
      return formatMethodResults(results, 'No senders found.');
    })(args),
  );

  server.tool(
    'get_class_definition',
    'Get the class definition (superclass, instance variables, etc.) for a class.',
    { className: z.string().describe('Class name, e.g. "Array"') },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.getClassDefinition(session, a.className);
    })(args),
  );

  server.tool(
    'get_class_hierarchy',
    'Get the superclass chain and direct subclasses of a class.',
    { className: z.string().describe('Class name') },
    async (args) => wrap<typeof args>((session, a) => {
      const entries = queries.getClassHierarchy(session, a.className);
      return entries
        .map(e => `${e.dictName}\t${e.className}\t${e.kind}`)
        .join('\n');
    })(args),
  );

  server.tool(
    'get_method_source',
    'Get the source code of a method.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      selector: z.string().describe('Method selector, e.g. "printOn:"'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.getMethodSource(session, a.className, a.isMeta, a.selector, a.environmentId ?? 0);
    })(args),
  );

  server.tool(
    'list_classes',
    'List all classes in a given symbol dictionary.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async (args) => wrap<typeof args>((session, a) => {
      // Resolve dictionary name to index, then list classes.
      const names = queries.getDictionaryNames(session);
      const idx = names.findIndex(n => n === a.dictionaryName);
      if (idx < 0) return `Dictionary not found: ${a.dictionaryName}`;
      return queries.getClassNames(session, idx + 1).join('\n');
    })(args),
  );

  server.tool(
    'list_dictionaries',
    'List all symbol dictionaries in the current user\'s symbol list.',
    {},
    async () => wrap<Record<string, unknown>>((session) => {
      return queries.getDictionaryNames(session).join('\n');
    })({}),
  );

  server.tool(
    'list_methods',
    'List all methods of a class, grouped by category. Returns tab-separated lines: side (instance|class), category, selector.',
    { className: z.string().describe('Class name') },
    async (args) => wrap<typeof args>((session, a) => {
      const methods = queries.getMethodList(session, a.className);
      if (methods.length === 0) return 'No methods found.';
      return methods
        .map(m => `${m.isMeta ? 'class' : 'instance'}\t${m.category}\t${m.selector}`)
        .join('\n');
    })(args),
  );

  server.tool(
    'run_test_class',
    'Run all SUnit test methods in a TestCase subclass and return per-method pass/fail/error results.',
    { className: z.string().describe('TestCase subclass name') },
    async (args) => wrap<typeof args>((session, a) => {
      const code = `| suite result ws |
suite := ${a.className} suite.
result := suite run.
ws := WriteStream on: Unicode7 new.
ws nextPutAll: result printString; lf; lf.
result passed do: [:each |
  ws nextPutAll: 'PASSED: '; nextPutAll: each class name;
    nextPutAll: ' >> '; nextPutAll: each selector; lf].
result failures do: [:each |
  ws nextPutAll: 'FAILED: '; nextPutAll: each testCase class name;
    nextPutAll: ' >> '; nextPutAll: each testCase selector; lf;
    nextPutAll: '  '; nextPutAll: (each printString copyFrom: 1 to: (each printString size min: 4096)); lf].
result errors do: [:each |
  ws nextPutAll: 'ERROR: '; nextPutAll: each testCase class name;
    nextPutAll: ' >> '; nextPutAll: each testCase selector; lf;
    nextPutAll: '  '; nextPutAll: (each printString copyFrom: 1 to: (each printString size min: 4096)); lf].
ws contents`;
      return executeString(session, code);
    })(args),
  );

  server.tool(
    'run_test_method',
    'Run a single SUnit test method and return pass/fail/error with details.',
    {
      className: z.string().describe('TestCase subclass name'),
      selector: z.string().describe('Test method selector, e.g. "testAdd"'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      const code = `| testCase result ws startMs endMs |
startMs := Time millisecondClockValue.
testCase := ${a.className} selector: #'${escapeString(a.selector)}'.
result := testCase run.
endMs := Time millisecondClockValue.
ws := WriteStream on: Unicode7 new.
(result hasPassed)
  ifTrue: [ws nextPutAll: 'PASSED']
  ifFalse: [
    result failures size > 0
      ifTrue: [
        | failure |
        failure := result failures asArray first.
        ws nextPutAll: 'FAILED: ';
          nextPutAll: (failure printString copyFrom: 1 to: (failure printString size min: 4096))]
      ifFalse: [
        | err |
        err := result errors asArray first.
        ws nextPutAll: 'ERROR: ';
          nextPutAll: (err printString copyFrom: 1 to: (err printString size min: 4096))]].
ws nextPutAll: ' ('; nextPutAll: (endMs - startMs) printString; nextPutAll: 'ms)'.
ws contents`;
      return executeString(session, code);
    })(args),
  );

  server.tool(
    'search_method_source',
    'Search method source for a substring. Returns up to 500 matches with class, selector, and category.',
    {
      term: z.string().describe('Text to search for in method source'),
      ignoreCase: z.boolean().optional().describe('Case-insensitive search (default true)'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      const results = queries.searchMethodSource(session, a.term, a.ignoreCase ?? true);
      return formatMethodResults(results, 'No matches found.');
    })(args),
  );

  server.tool(
    'status',
    'Report information about the user\'s active GemStone session: user, stone, version, transaction state, and dirty objects.',
    {},
    async () => wrap<Record<string, unknown>>((session) => {
      const code = `| ws |
ws := WriteStream on: Unicode7 new.
ws nextPutAll: 'User: '; nextPutAll: System myUserProfile userId; lf.
ws nextPutAll: 'Stone: '; nextPutAll: System stoneName; lf.
ws nextPutAll: 'Version: '; nextPutAll: System stoneVersionReport; lf.
ws nextPutAll: 'Session ID: '; nextPutAll: System session printString; lf.
ws nextPutAll: 'Transaction: '; nextPutAll: (System inTransaction ifTrue: ['active'] ifFalse: ['none']); lf.
ws nextPutAll: 'Dirty objects: '; nextPutAll: System modifiedObjects size printString; lf.
ws contents`;
      return executeString(session, code);
    })({}),
  );
}

// ── Helpers (local) ────────────────────────────────────────────────────────

function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

function formatMethodResults(
  results: queries.MethodSearchResult[],
  fallback: string,
): string {
  if (results.length === 0) return fallback;
  return results
    .map(r => `${r.dictName}\t${r.className}\t${r.isMeta ? 'class' : 'instance'}\t${r.selector}\t${r.category}`)
    .join('\n');
}

function executeString(session: ActiveSession, code: string): string {
  return queries.executeFetchString(session, 'mcpTool', code);
}
