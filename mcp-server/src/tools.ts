import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpSession } from './mcpSession';

function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

function receiver(className: string, isMeta: boolean): string {
  return isMeta ? `${className} class` : className;
}

function methodSerialization(envId: number): string {
  return `sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
limit := methods size min: 500.
1 to: limit do: [:i |
  | each cls baseClass |
  each := methods at: i.
  cls := each inClass.
  baseClass := cls theNonMetaClass.
  stream
    nextPutAll: (classDict at: baseClass ifAbsent: ['']); tab;
    nextPutAll: baseClass name; tab;
    nextPutAll: (cls isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
    nextPutAll: each selector; tab;
    nextPutAll: ((cls categoryOfSelector: each selector environmentId: ${envId}) ifNil: ['']); lf.
].
stream contents`;
}

export function registerTools(server: McpServer, session: McpSession): void {

  // Tools are registered in alphabetical order.

  server.tool(
    'abort',
    'Abort the current transaction, discarding all uncommitted changes (compiled methods, object modifications, etc.).',
    {},
    async () => {
      try {
        const result = session.executeFetchString(`System abortTransaction. 'Transaction aborted'`);
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
    'commit',
    'Commit the current transaction, persisting all changes (compiled methods, object modifications, etc.).',
    {},
    async () => {
      try {
        const result = session.executeFetchString(
          `System commitTransaction
  ifTrue: ['Transaction committed']
  ifFalse: ['Commit failed — possible conflict. Use abort to reset, then retry.']`,
        );
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
    'compile_method',
    'Compile (add or update) a method on a class. The change is NOT committed automatically — call abort to undo, or commit to persist.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      category: z.string().describe('Method category, e.g. "accessing"'),
      source: z.string().describe('Full method source including the selector line'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async ({ className, isMeta, category, source, environmentId }) => {
      try {
        const recv = receiver(className, isMeta);
        const envId = environmentId ?? 0;
        const code = `${recv}
  compileMethod: '${escapeString(source)}'
  dictionaries: System myUserProfile symbolList
  category: '${escapeString(category)}'
  environmentId: ${envId}.
'Compiled successfully: ${escapeString(recv)} >> ' , (('${escapeString(source)}' copyUpTo: Character lf) copyUpTo: Character cr)`;
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

  server.tool(
    'execute_code',
    'Execute GemStone Smalltalk code and return the result as a string (via printString). ' +
    'Changes are NOT committed automatically.',
    { code: z.string().describe('Smalltalk expression to execute') },
    async ({ code }) => {
      try {
        // Wrap so the result is always a String — GciTsExecuteFetchBytes
        // requires a byte object, but the user's code may return any object.
        // Use printString consistently (Smalltalk convention for unambiguous display).
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
    'find_implementors',
    'Find all classes that implement a given selector. Returns up to 500 results.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async ({ selector, environmentId }) => {
      try {
        const envId = environmentId ?? 0;
        const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${envId}; yourself)
  implementorsOf: #'${escapeString(selector)}') asArray.
${methodSerialization(envId)}`;
        const result = session.executeFetchString(code);
        return { content: [{ type: 'text' as const, text: result || 'No implementors found.' }] };
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
        const envId = environmentId ?? 0;
        const code = `| methods stream limit classDict sl |
methods := ((ClassOrganizer new environmentId: ${envId}; yourself)
  sendersOf: #'${escapeString(selector)}') at: 1.
${methodSerialization(envId)}`;
        const result = session.executeFetchString(code);
        return { content: [{ type: 'text' as const, text: result || 'No senders found.' }] };
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
        const code = `${className} definition`;
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

  server.tool(
    'get_class_hierarchy',
    'Get the superclass chain and direct subclasses of a class.',
    { className: z.string().describe('Class name') },
    async ({ className }) => {
      try {
        const code = `| organizer class supers subs stream classDict sl |
organizer := ClassOrganizer new.
class := System myUserProfile symbolList objectNamed: #'${escapeString(className)}'.
supers := organizer allSuperclassesOf: class.
subs := organizer subclassesOf: class.
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior and: [(classDict includesKey: v) not])
      ifTrue: [classDict at: v put: dict name]]].
stream := WriteStream on: Unicode7 new.
supers reverseDo: [:each |
  stream nextPutAll: (classDict at: each ifAbsent: ['']); tab;
    nextPutAll: each name; tab; nextPutAll: 'superclass'; lf].
stream nextPutAll: (classDict at: class ifAbsent: ['']); tab;
  nextPutAll: class name; tab; nextPutAll: 'self'; lf.
(subs asSortedCollection: [:a :b | a name <= b name]) do: [:each |
  stream nextPutAll: (classDict at: each ifAbsent: ['']); tab;
    nextPutAll: each name; tab; nextPutAll: 'subclass'; lf].
stream contents`;
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
        const recv = receiver(className, isMeta);
        const envId = environmentId ?? 0;
        const code = envId === 0
          ? `(${recv} compiledMethodAt: #'${escapeString(selector)}') sourceString`
          : `(${recv} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${envId}) sourceString`;
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

  server.tool(
    'list_classes',
    'List all classes in a given symbol dictionary.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async ({ dictionaryName }) => {
      try {
        const code = `| ws dict |
dict := System myUserProfile symbolList objectNamed: #'${escapeString(dictionaryName)}'.
dict ifNil: [^ 'Dictionary not found: ${escapeString(dictionaryName)}'].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [ws nextPutAll: k; lf]].
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

  server.tool(
    'list_dictionaries',
    'List all symbol dictionaries in the current user\'s symbol list.',
    {},
    async () => {
      try {
        const code = `| ws |
ws := WriteStream on: String new.
System myUserProfile symbolList names do: [:each |
  ws nextPutAll: each; lf].
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

  server.tool(
    'list_methods',
    'List all methods of a class, grouped by category. Returns tab-separated lines: isMeta, category, selector.',
    { className: z.string().describe('Class name') },
    async ({ className }) => {
      try {
        const code = `| ws class |
ws := WriteStream on: Unicode7 new.
class := ${className}.
{ class. class class } doWithIndex: [:cls :idx |
  | isMeta |
  isMeta := idx = 2.
  cls categoryNames asSortedCollection do: [:cat |
    (cls sortedSelectorsIn: cat) do: [:sel |
      ws
        nextPutAll: (isMeta ifTrue: ['class'] ifFalse: ['instance']); tab;
        nextPutAll: cat; tab;
        nextPutAll: sel; lf]]].
ws contents`;
        const result = session.executeFetchString(code);
        return { content: [{ type: 'text' as const, text: result || 'No methods found.' }] };
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
        const code = `| suite result ws |
suite := ${className} suite.
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

  server.tool(
    'run_test_method',
    'Run a single SUnit test method and return pass/fail/error with details.',
    {
      className: z.string().describe('TestCase subclass name'),
      selector: z.string().describe('Test method selector, e.g. "testAdd"'),
    },
    async ({ className, selector }) => {
      try {
        const code = `| testCase result ws startMs endMs |
startMs := Time millisecondClockValue.
testCase := ${className} selector: #'${escapeString(selector)}'.
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

  server.tool(
    'search_method_source',
    'Search method source code for a substring. Returns up to 500 matches with class, selector, and category.',
    {
      term: z.string().describe('Text to search for in method source'),
      ignoreCase: z.boolean().optional().describe('Case-insensitive search (default true)'),
    },
    async ({ term, ignoreCase }) => {
      try {
        const caseSensitive = ignoreCase === false ? 'false' : 'true';
        const code = `| results methods stream limit classDict sl |
results := ClassOrganizer new substringSearch: '${escapeString(term)}' ignoreCase: ${caseSensitive}.
methods := results at: 1.
${methodSerialization(0)}`;
        const result = session.executeFetchString(code);
        return { content: [{ type: 'text' as const, text: result || 'No matches found.' }] };
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
