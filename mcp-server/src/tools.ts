import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpSession } from './mcpSession';

import { QueryExecutor } from '../../client/src/queries/types';
import { getMethodSource } from '../../client/src/queries/getMethodSource';
import { abortTransaction } from '../../client/src/queries/abortTransaction';
import { commitTransaction } from '../../client/src/queries/commitTransaction';
import { runTestMethod, TestRunResult } from '../../client/src/queries/runTestMethod';
import { runTestClass } from '../../client/src/queries/runTestClass';
import { getDictionaryNames } from '../../client/src/queries/getDictionaryNames';
import { getClassNames } from '../../client/src/queries/getClassNames';
import { getDictionaryEntries } from '../../client/src/queries/getDictionaryEntries';
import { getAllClassNames } from '../../client/src/queries/getAllClassNames';
import { getMethodList } from '../../client/src/queries/getMethodList';
import { getClassDefinition } from '../../client/src/queries/getClassDefinition';
import { getClassHierarchy } from '../../client/src/queries/getClassHierarchy';
import { describeClass } from '../../client/src/queries/describeClass';
import { fileOutClass } from '../../client/src/queries/fileOutClass';
import { compileMethod } from '../../client/src/queries/compileMethod';
import { compileClassDefinition } from '../../client/src/queries/compileClassDefinition';
import { setClassComment } from '../../client/src/queries/setClassComment';
import { deleteMethod } from '../../client/src/queries/deleteMethod';
import { deleteClass } from '../../client/src/queries/deleteClass';
import { addDictionary } from '../../client/src/queries/addDictionary';
import { removeDictionary } from '../../client/src/queries/removeDictionary';
import {
  searchMethodSource, sendersOf, implementorsOf, referencesToObject,
  MethodSearchResult,
} from '../../client/src/queries/methodSearch';

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

function formatMethodResults(results: MethodSearchResult[], fallback: string): string {
  if (results.length === 0) return fallback;
  return results
    .map(r => `${r.dictName}\t${r.className}\t${r.isMeta ? 'class' : 'instance'}\t${r.selector}\t${r.category}`)
    .join('\n');
}

export function registerTools(server: McpServer, session: McpSession): void {

  // Bind this session into the QueryExecutor shape shared queries expect.
  // Label is used only for client-side logging, ignored here.
  const exec: QueryExecutor = (_label, code) => session.executeFetchString(code);

  // Tools are registered in alphabetical order.

  server.tool(
    'abort',
    'Abort the current transaction, discarding all uncommitted changes (compiled methods, object modifications, etc.).',
    {},
    async () => {
      try {
        const text = abortTransaction(exec);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'add_dictionary',
    'Create a new SymbolDictionary and append it to the current user\'s symbolList. ' +
    'NOT committed automatically — call commit to persist or abort to undo.',
    { dictionaryName: z.string().describe('Name of the new dictionary') },
    async ({ dictionaryName }) => {
      try {
        const text = addDictionary(exec, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'commit',
    'Commit the current transaction, persisting all changes (compiled methods, object modifications, etc.).',
    {},
    async () => {
      try {
        const text = commitTransaction(exec);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ source }) => {
      try {
        const text = compileClassDefinition(exec, source);
        return { content: [{ type: 'text' as const, text: `Class: ${text}` }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'compile_method',
    'Compile (add or update) a method on a class. The change is NOT committed automatically — call abort to undo, or commit to persist. ' +
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
    async ({ className, isMeta, category, source, environmentId, dictionaryName }) => {
      try {
        const text = compileMethod(
          exec, className, isMeta, category, source, environmentId ?? 0, dictionaryName,
        );
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, dictionaryName }) => {
      try {
        const text = deleteClass(exec, dictionaryName, className);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, isMeta, selector, dictionaryName }) => {
      try {
        const text = deleteMethod(exec, className, isMeta, selector, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, dictionaryName }) => {
      try {
        const text = describeClass(exec, className, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'execute_code',
    'Execute GemStone Smalltalk code and return the result as a string (via printString). ' +
    'Changes are NOT committed automatically.',
    { code: z.string().describe('Smalltalk expression to execute') },
    async ({ code }) => {
      try {
        // Wrap so the result is always a String — GciTsExecuteFetchBytes
        // requires a byte object, but the user's code may return any object.
        const wrapped = `(${code}) printString`;
        const result = session.executeFetchString(wrapped);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, dictionaryName }) => {
      try {
        const text = fileOutClass(exec, className, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'find_implementors',
    'Find all classes that implement a given selector. Returns up to 500 results.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async ({ selector, environmentId }) => {
      try {
        const results = implementorsOf(exec, selector, environmentId ?? 0);
        return { content: [{ type: 'text' as const, text: formatMethodResults(results, 'No implementors found.') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ objectName, environmentId }) => {
      try {
        const results = referencesToObject(exec, objectName, environmentId ?? 0);
        return { content: [{ type: 'text' as const, text: formatMethodResults(results, 'No references found.') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'find_senders',
    'Find all methods that send a given selector. Returns up to 500 results.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async ({ selector, environmentId }) => {
      try {
        const results = sendersOf(exec, selector, environmentId ?? 0);
        return { content: [{ type: 'text' as const, text: formatMethodResults(results, 'No senders found.') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_class_definition',
    'Get the class definition (superclass, instance variables, etc.) for a GemStone class.',
    { className: z.string().describe('Class name, e.g. "Array"') },
    async ({ className }) => {
      try {
        const result = getClassDefinition(exec, className);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_class_hierarchy',
    'Get the superclass chain and direct subclasses of a class.',
    { className: z.string().describe('Class name') },
    async ({ className }) => {
      try {
        const entries = getClassHierarchy(exec, className);
        const text = entries
          .map(e => `${e.dictName}\t${e.className}\t${e.kind}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_method_source',
    'Get the source code of a method.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side methods, false for instance-side'),
      selector: z.string().describe('Method selector, e.g. "printOn:"'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async ({ className, isMeta, selector, environmentId }) => {
      try {
        const result = getMethodSource(exec, className, isMeta, selector, environmentId ?? 0);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_all_classes',
    'Enumerate every class in the user\'s symbol list along with its dictionary. ' +
    'Bulk schema discovery; use when you don\'t know which dictionary a class lives in. ' +
    'Returns tab-separated rows: dictIndex, dictName, className. May be large on big schemas.',
    {},
    async () => {
      try {
        const entries = getAllClassNames(exec);
        const text = entries
          .map(e => `${e.dictIndex}\t${e.dictName}\t${e.className}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_classes',
    'List all classes in a given symbol dictionary.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async ({ dictionaryName }) => {
      try {
        const names = getClassNames(exec, dictionaryName);
        if (names.length === 0) {
          return { content: [{ type: 'text' as const, text: `Dictionary not found or empty: ${dictionaryName}` }] };
        }
        return { content: [{ type: 'text' as const, text: names.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_dictionaries',
    'List all symbol dictionaries in the current user\'s symbol list.',
    {},
    async () => {
      try {
        const names = getDictionaryNames(exec);
        return { content: [{ type: 'text' as const, text: names.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_dictionary_entries',
    'List every entry in a symbol dictionary, including classes (with their categories) and ' +
    'globals (non-class entries like pools and shared variables). Richer than list_classes. ' +
    'Returns tab-separated rows: kind (class|global), category, name.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async ({ dictionaryName }) => {
      try {
        const entries = getDictionaryEntries(exec, dictionaryName);
        if (entries.length === 0) {
          return { content: [{ type: 'text' as const, text: `Dictionary not found or empty: ${dictionaryName}` }] };
        }
        const text = entries
          .map(e => `${e.isClass ? 'class' : 'global'}\t${e.category}\t${e.name}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_methods',
    'List all methods of a class, grouped by category. Returns tab-separated lines: side (instance|class), category, selector.',
    { className: z.string().describe('Class name') },
    async ({ className }) => {
      try {
        const methods = getMethodList(exec, className);
        if (methods.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No methods found.' }] };
        }
        const text = methods
          .map(m => `${m.isMeta ? 'class' : 'instance'}\t${m.category}\t${m.selector}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'remove_dictionary',
    'DESTRUCTIVE: remove a dictionary from the current user\'s symbolList. ' +
    'NOT committed automatically.',
    { dictionaryName: z.string().describe('Name of the dictionary to remove') },
    async ({ dictionaryName }) => {
      try {
        const text = removeDictionary(exec, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'run_test_class',
    'Run all SUnit test methods in a TestCase subclass and return per-method pass/fail/error results.',
    {
      className: z.string().describe('TestCase subclass name'),
    },
    async ({ className }) => {
      try {
        const results = runTestClass(exec, className);
        const text = formatTestResults(results);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'run_test_method',
    'Run a single SUnit test method and return pass/fail/error with details.',
    {
      className: z.string().describe('TestCase subclass name'),
      selector: z.string().describe('Test method selector, e.g. "testAdd"'),
    },
    async ({ className, selector }) => {
      try {
        const r = runTestMethod(exec, className, selector);
        const text = formatTestResult(r);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'search_method_source',
    'Search method source code for a substring. Returns up to 500 matches with class, selector, and category.',
    {
      term: z.string().describe('Text to search for in method source'),
      ignoreCase: z.boolean().optional().describe('Case-insensitive search (default true)'),
    },
    async ({ term, ignoreCase }) => {
      try {
        const results = searchMethodSource(exec, term, ignoreCase !== false);
        return { content: [{ type: 'text' as const, text: formatMethodResults(results, 'No matches found.') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, comment, dictionaryName }) => {
      try {
        const text = setClassComment(exec, className, comment, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'status',
    'Report information about the current GemStone session: user, stone, version, transaction state, and dirty objects.',
    {},
    async () => {
      try {
        const code = `| ws |
ws := WriteStream on: Unicode7 new.
ws nextPutAll: 'User: '; nextPutAll: System myUserProfile userId; lf.
ws nextPutAll: 'Stone: '; nextPutAll: System stoneName; lf.
ws nextPutAll: 'Version: '; nextPutAll: System stoneVersionReport; lf.
ws nextPutAll: 'Session ID: '; nextPutAll: System session printString; lf.
ws nextPutAll: 'Transaction: '; nextPutAll: (System inTransaction ifTrue: ['active'] ifFalse: ['none']); lf.
ws nextPutAll: 'Dirty objects: '; nextPutAll: System modifiedObjects size printString; lf.
ws contents`;
        const result = session.executeFetchString(code);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
