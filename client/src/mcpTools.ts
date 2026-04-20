import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import * as sunit from './sunitQueries';
import type { TestRunResult } from './queries/runTestMethod';

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
      return executeString(session, `System abortTransaction. 'Transaction aborted'`);
    })({}),
  );

  server.tool(
    'add_dictionary',
    'Create a new SymbolDictionary and append it to the current user\'s symbolList. ' +
    'NOT committed automatically — call commit to persist or abort to undo.',
    { dictionaryName: z.string().describe('Name of the new dictionary') },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.addDictionary(session, a.dictionaryName);
    })(args),
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
    'compile_class_definition',
    'Evaluate a class-definition expression (e.g. `Object subclass: \'Foo\' ... inDictionary: \'UserGlobals\'`). ' +
    'Creates the class if new, updates it if it exists. The source embeds its own dictionary target. ' +
    'NOT committed automatically.',
    {
      source: z.string().describe(
        'Full class-definition Smalltalk expression including the "subclass:" keyword send and inDictionary:',
      ),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return `Class: ${queries.compileClassDefinition(session, a.source)}`;
    })(args),
  );

  server.tool(
    'compile_method',
    'Compile (add or update) a method on a class in the user\'s active session. Not committed automatically. ' +
    'Optional dictionaryName disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      category: z.string().describe('Method category, e.g. "accessing"'),
      source: z.string().describe('Full method source including the selector line'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
      dictionaryName: z.string().optional().describe(
        'Optional dictionary to scope the class lookup. Omit for first-match resolution.',
      ),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.compileMethod(
        session, a.className, a.isMeta, a.category, a.source, a.environmentId ?? 0, a.dictionaryName,
      );
    })(args),
  );

  server.tool(
    'delete_class',
    'DESTRUCTIVE: remove a class from a specific dictionary. Requires dictionaryName because ' +
    'deletion must target a specific dictionary (names can be shadowed across dicts). ' +
    'NOT committed automatically — abort undoes it.',
    {
      className: z.string().describe('Class name to delete'),
      dictionaryName: z.string().describe('Name of the dictionary that contains the class'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.deleteClass(session, a.dictionaryName, a.className);
    })(args),
  );

  server.tool(
    'delete_method',
    'Remove a method from a class. NOT committed automatically. Optional dictionaryName ' +
    'disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      selector: z.string().describe('Method selector to remove'),
      dictionaryName: z.string().optional().describe(
        'Optional dictionary to scope the class lookup.',
      ),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.deleteMethod(session, a.className, a.isMeta, a.selector, a.dictionaryName);
    })(args),
  );

  server.tool(
    'describe_class',
    'Agent-focused: combined class description in one round trip. Returns the class definition ' +
    '(superclass, instance/class variables, pool dictionaries), class comment, and own methods ' +
    'grouped by category for both instance and class sides. Does NOT include inherited selectors. ' +
    'Prefer this over calling get_class_definition + list_methods separately when you want to ' +
    'understand a class. Optional dictionaryName disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name, e.g. "Array"'),
      dictionaryName: z.string().optional().describe(
        'Optional dictionary to scope the lookup. Omit to use first-match resolution across the symbolList.',
      ),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.describeClass(session, a.className, a.dictionaryName);
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
    'export_class_source',
    'Export a class as Topaz file-in source (full definition plus all methods). Useful for ' +
    'backing up a class or transporting it between environments. Optional dictionaryName ' +
    'disambiguates shadowed class names; without it, resolves to the first match in the ' +
    'symbolList (the class the user\'s code actually binds to).',
    {
      className: z.string().describe('Class name, e.g. "Array"'),
      dictionaryName: z.string().optional().describe(
        'Optional dictionary to scope the lookup. Omit for first-match resolution.',
      ),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.fileOutClass(session, a.className, a.dictionaryName);
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
    'find_references_to',
    'Find all methods that reference a named global (class, pool, or shared variable). ' +
    'Sister to find_senders, which matches a selector; this matches a global by name. ' +
    'Returns up to 500 results.',
    {
      objectName: z.string().describe('Name of the global to find references to, e.g. "AllUsers"'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async (args) => wrap<typeof args>((session, a) => {
      const results = queries.referencesToObject(session, a.objectName, a.environmentId ?? 0);
      return formatMethodResults(results, 'No references found.');
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
    'list_all_classes',
    'Enumerate every class in the user\'s symbol list along with its dictionary. ' +
    'Bulk schema discovery; use when you don\'t know which dictionary a class lives in. ' +
    'Returns tab-separated rows: dictIndex, dictName, className. May be large on big schemas.',
    {},
    async () => wrap<Record<string, unknown>>((session) => {
      const entries = queries.getAllClassNames(session);
      return entries
        .map(e => `${e.dictIndex}\t${e.dictName}\t${e.className}`)
        .join('\n');
    })({}),
  );

  server.tool(
    'list_classes',
    'List all classes in a given symbol dictionary.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async (args) => wrap<typeof args>((session, a) => {
      const names = queries.getClassNames(session, a.dictionaryName);
      if (names.length === 0) return `Dictionary not found or empty: ${a.dictionaryName}`;
      return names.join('\n');
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
    'list_dictionary_entries',
    'List every entry in a symbol dictionary, including classes (with their categories) and ' +
    'globals (non-class entries like pools and shared variables). Richer than list_classes. ' +
    'Returns tab-separated rows: kind (class|global), category, name.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async (args) => wrap<typeof args>((session, a) => {
      const entries = queries.getDictionaryEntries(session, a.dictionaryName);
      if (entries.length === 0) return `Dictionary not found or empty: ${a.dictionaryName}`;
      return entries
        .map(e => `${e.isClass ? 'class' : 'global'}\t${e.category}\t${e.name}`)
        .join('\n');
    })(args),
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
    'remove_dictionary',
    'DESTRUCTIVE: remove a dictionary from the current user\'s symbolList. ' +
    'NOT committed automatically.',
    { dictionaryName: z.string().describe('Name of the dictionary to remove') },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.removeDictionary(session, a.dictionaryName);
    })(args),
  );

  server.tool(
    'run_test_class',
    'Run all SUnit test methods in a TestCase subclass and return per-method pass/fail/error results.',
    { className: z.string().describe('TestCase subclass name') },
    async (args) => wrap<typeof args>((session, a) => {
      const results = sunit.runTestClass(session, a.className);
      return formatTestResults(results);
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
      const r = sunit.runTestMethod(session, a.className, a.selector);
      return formatTestResult(r);
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
    'set_class_comment',
    'Set the class comment (docstring equivalent). Replaces any existing comment. ' +
    'NOT committed automatically. Optional dictionaryName disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name'),
      comment: z.string().describe('New comment text'),
      dictionaryName: z.string().optional().describe(
        'Optional dictionary to scope the class lookup.',
      ),
    },
    async (args) => wrap<typeof args>((session, a) => {
      return queries.setClassComment(session, a.className, a.comment, a.dictionaryName);
    })(args),
  );

  server.tool(
    'status',
    'Report information about the user\'s active GemStone session: user, stone, transaction state, and whether there are uncommitted changes.',
    {},
    async () => wrap<Record<string, unknown>>((session) => {
      // Every value put into the stream must be a CharacterCollection; otherwise
      // nextPutAll: sends do: to it and GemStone complains (e.g. SmallInteger
      // DNU do:). Coerce with asString / printString to keep it robust across
      // GemStone versions where these System methods return different types.
      const code = `| ws |
ws := WriteStream on: String new.
ws nextPutAll: 'User: '; nextPutAll: System myUserProfile userId asString; lf.
ws nextPutAll: 'Stone: '; nextPutAll: System stoneName asString; lf.
ws nextPutAll: 'Session ID: '; nextPutAll: System session printString; lf.
ws nextPutAll: 'Transaction: '; nextPutAll: (System inTransaction ifTrue: ['active'] ifFalse: ['none']); lf.
ws nextPutAll: 'Uncommitted changes: '; nextPutAll: (System needsCommit ifTrue: ['yes'] ifFalse: ['no']); lf.
ws contents`;
      return executeString(session, code);
    })({}),
  );
}

// ── Helpers (local) ────────────────────────────────────────────────────────

function formatMethodResults(
  results: queries.MethodSearchResult[],
  fallback: string,
): string {
  if (results.length === 0) return fallback;
  return results
    .map(r => `${r.dictName}\t${r.className}\t${r.isMeta ? 'class' : 'instance'}\t${r.selector}\t${r.category}`)
    .join('\n');
}

function formatTestResult(r: TestRunResult): string {
  const prefix = r.status === 'passed' ? 'PASSED' : r.status === 'failed' ? 'FAILED' : 'ERROR';
  const msg = r.message ? `: ${r.message}` : '';
  return `${prefix}${msg} (${r.durationMs}ms)`;
}

function formatTestResults(results: TestRunResult[]): string {
  return results
    .map(r => {
      const prefix = r.status === 'passed' ? 'PASSED' : r.status === 'failed' ? 'FAILED' : 'ERROR';
      const msg = r.message ? `\n  ${r.message}` : '';
      return `${prefix}: ${r.className} >> ${r.selector}${msg}`;
    })
    .join('\n');
}

function executeString(session: ActiveSession, code: string): string {
  return queries.executeFetchString(session, 'mcpTool', code);
}
