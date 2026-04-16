import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
// browserQueries imports sessionManager (vscode) and gciLog (vscode).
// The vscode mock covers that; we mock the specific query functions we rely on.
vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
  implementorsOf: vi.fn(() => [] as unknown[]),
  sendersOf: vi.fn(() => [] as unknown[]),
  referencesToObject: vi.fn(() => [] as unknown[]),
  getClassDefinition: vi.fn(() => ''),
  getClassHierarchy: vi.fn(() => [] as unknown[]),
  getMethodSource: vi.fn(() => ''),
  getMethodList: vi.fn(() => [] as unknown[]),
  getDictionaryNames: vi.fn(() => [] as string[]),
  getClassNames: vi.fn(() => [] as string[]),
  getDictionaryEntries: vi.fn(() => [] as unknown[]),
  getAllClassNames: vi.fn(() => [] as unknown[]),
  searchMethodSource: vi.fn(() => [] as unknown[]),
  describeClass: vi.fn(() => ''),
  fileOutClass: vi.fn(() => ''),
  compileMethod: vi.fn(() => ''),
  compileClassDefinition: vi.fn(() => ''),
  setClassComment: vi.fn(() => ''),
  deleteMethod: vi.fn(() => ''),
  deleteClass: vi.fn(() => ''),
  addDictionary: vi.fn(() => ''),
  removeDictionary: vi.fn(() => ''),
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) { super(msg); this.gciErrorNumber = num; }
  },
}));
vi.mock('../sunitQueries', () => ({
  runTestMethod: vi.fn(() => ({ className: '', selector: '', status: 'passed', message: '', durationMs: 0 })),
  runTestClass: vi.fn(() => []),
  SunitQueryError: class SunitQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) { super(msg); this.gciErrorNumber = num; }
  },
}));

import * as queries from '../browserQueries';
import * as sunit from '../sunitQueries';
import { registerMcpTools } from '../mcpTools';
import { ActiveSession } from '../sessionManager';

interface ToolRegistration {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

function createMockServer() {
  const tools: ToolRegistration[] = [];
  return {
    tool: vi.fn((
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: ToolRegistration['handler'],
    ) => {
      tools.push({ name, description, schema, handler });
    }),
    getTool: (name: string) => tools.find(t => t.name === name),
    getToolNames: () => tools.map(t => t.name),
  };
}

function makeSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: { label: 'DataCurator on gs64stone (localhost)' } as ActiveSession['login'],
    stoneVersion: '3.7.4',
  };
}

describe('registerMcpTools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: ActiveSession | undefined;

  beforeEach(() => {
    server = createMockServer();
    session = makeSession();
    registerMcpTools(
      server as unknown as Parameters<typeof registerMcpTools>[0],
      () => session,
    );
    vi.clearAllMocks();
  });

  it('registers the expected 27 tools in alphabetical order', () => {
    const names = server.getToolNames();
    expect(names).toEqual([
      'abort',
      'add_dictionary',
      'commit',
      'compile_class_definition',
      'compile_method',
      'delete_class',
      'delete_method',
      'describe_class',
      'execute_code',
      'export_class_source',
      'find_implementors',
      'find_references_to',
      'find_senders',
      'get_class_definition',
      'get_class_hierarchy',
      'get_method_source',
      'list_all_classes',
      'list_classes',
      'list_dictionaries',
      'list_dictionary_entries',
      'list_methods',
      'remove_dictionary',
      'run_test_class',
      'run_test_method',
      'search_method_source',
      'set_class_comment',
      'status',
    ]);
  });

  describe('without an active session', () => {
    beforeEach(() => {
      session = undefined;
    });

    it('execute_code returns an error response', async () => {
      const result = await server.getTool('execute_code')!.handler({ code: '42' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/No active GemStone session/);
      expect(queries.executeFetchString).not.toHaveBeenCalled();
    });

    it('get_class_definition returns an error response', async () => {
      const result = await server.getTool('get_class_definition')!.handler({ className: 'Array' });
      expect(result.isError).toBe(true);
      expect(queries.getClassDefinition).not.toHaveBeenCalled();
    });

    it('abort returns an error response', async () => {
      const result = await server.getTool('abort')!.handler({});
      expect(result.isError).toBe(true);
      expect(queries.executeFetchString).not.toHaveBeenCalled();
    });
  });

  describe('with an active session', () => {
    it('execute_code wraps the code with printString', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('42');
      const result = await server.getTool('execute_code')!.handler({ code: '6 * 7' });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('42');
      const codeArg = vi.mocked(queries.executeFetchString).mock.calls[0][2];
      expect(codeArg).toContain('6 * 7');
      expect(codeArg).toContain('printString');
    });

    it('get_class_definition delegates to queries.getClassDefinition', async () => {
      vi.mocked(queries.getClassDefinition).mockReturnValue('Array definition');
      const result = await server.getTool('get_class_definition')!.handler({ className: 'Array' });

      expect(queries.getClassDefinition).toHaveBeenCalledWith(session, 'Array');
      expect(result.content[0].text).toBe('Array definition');
    });

    it('find_implementors formats results as tab-separated lines', async () => {
      vi.mocked(queries.implementorsOf).mockReturnValue([
        { dictName: 'Globals', className: 'Array', isMeta: false, selector: 'size', category: 'accessing' },
      ]);
      const result = await server.getTool('find_implementors')!.handler({ selector: 'size' });

      expect(queries.implementorsOf).toHaveBeenCalledWith(session, 'size', 0);
      expect(result.content[0].text).toContain('Globals\tArray\tinstance\tsize\taccessing');
    });

    it('find_implementors returns "No implementors found." when empty', async () => {
      vi.mocked(queries.implementorsOf).mockReturnValue([]);
      const result = await server.getTool('find_implementors')!.handler({ selector: 'xyz' });

      expect(result.content[0].text).toBe('No implementors found.');
    });

    it('list_classes delegates to getClassNames with the dictionary name', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Array', 'String']);
      const result = await server.getTool('list_classes')!.handler({ dictionaryName: 'UserGlobals' });

      expect(queries.getClassNames).toHaveBeenCalledWith(session, 'UserGlobals');
      expect(result.content[0].text).toBe('Array\nString');
    });

    it('describe_class passes through the combined text and forwards dictionaryName', async () => {
      vi.mocked(queries.describeClass).mockReturnValue('=== Definition ===\nObject subclass: #Foo\n');
      const result = await server.getTool('describe_class')!.handler({ className: 'Foo' });

      expect(queries.describeClass).toHaveBeenCalledWith(session, 'Foo', undefined);
      expect(result.content[0].text).toContain('=== Definition ===');
    });

    it('describe_class scopes to a specific dictionary when provided', async () => {
      vi.mocked(queries.describeClass).mockReturnValue('');
      await server.getTool('describe_class')!.handler({
        className: 'Customer', dictionaryName: 'UserGlobals',
      });

      expect(queries.describeClass).toHaveBeenCalledWith(session, 'Customer', 'UserGlobals');
    });

    it('export_class_source delegates to fileOutClass', async () => {
      vi.mocked(queries.fileOutClass).mockReturnValue('! file-out source');
      const result = await server.getTool('export_class_source')!.handler({ className: 'Foo' });

      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 'Foo', undefined);
      expect(result.content[0].text).toBe('! file-out source');
    });

    it('export_class_source scopes to a specific dictionary when provided', async () => {
      vi.mocked(queries.fileOutClass).mockReturnValue('');
      await server.getTool('export_class_source')!.handler({
        className: 'Customer', dictionaryName: 'UserGlobals',
      });

      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 'Customer', 'UserGlobals');
    });

    it('find_references_to formats results and defaults environmentId to 0', async () => {
      vi.mocked(queries.referencesToObject).mockReturnValue([
        { dictName: 'Globals', className: 'Foo', isMeta: false, selector: 'use', category: 'client' },
      ]);
      const result = await server.getTool('find_references_to')!.handler({ objectName: 'AllUsers' });

      expect(queries.referencesToObject).toHaveBeenCalledWith(session, 'AllUsers', 0);
      expect(result.content[0].text).toContain('Globals\tFoo\tinstance\tuse\tclient');
    });

    it('find_references_to returns "No references found." when empty', async () => {
      vi.mocked(queries.referencesToObject).mockReturnValue([]);
      const result = await server.getTool('find_references_to')!.handler({ objectName: 'Missing' });

      expect(result.content[0].text).toBe('No references found.');
    });

    it('list_all_classes emits dictIndex\\tdictName\\tclassName rows', async () => {
      vi.mocked(queries.getAllClassNames).mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 2, dictName: 'UserGlobals', className: 'MyClass' },
      ]);
      const result = await server.getTool('list_all_classes')!.handler({});

      expect(result.content[0].text).toBe('1\tGlobals\tArray\n2\tUserGlobals\tMyClass');
    });

    it('list_dictionary_entries emits kind\\tcategory\\tname rows', async () => {
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([
        { isClass: true, category: 'accessing', name: 'Array' },
        { isClass: false, category: '', name: 'MyVar' },
      ]);
      const result = await server.getTool('list_dictionary_entries')!.handler({ dictionaryName: 'Globals' });

      expect(queries.getDictionaryEntries).toHaveBeenCalledWith(session, 'Globals');
      expect(result.content[0].text).toBe('class\taccessing\tArray\nglobal\t\tMyVar');
    });

    it('list_dictionary_entries reports empty dictionary with a friendly message', async () => {
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([]);
      const result = await server.getTool('list_dictionary_entries')!.handler({ dictionaryName: 'NoSuchDict' });

      expect(result.content[0].text).toBe('Dictionary not found or empty: NoSuchDict');
    });

    it('list_classes reports unknown/empty dictionary', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue([]);
      const result = await server.getTool('list_classes')!.handler({ dictionaryName: 'Missing' });

      expect(result.content[0].text).toBe('Dictionary not found or empty: Missing');
    });

    it('abort runs System abortTransaction', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('Transaction aborted');
      const result = await server.getTool('abort')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][2];
      expect(code).toContain('abortTransaction');
      expect(result.content[0].text).toBe('Transaction aborted');
    });

    it('commit runs System commitTransaction', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('Transaction committed');
      const result = await server.getTool('commit')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][2];
      expect(code).toContain('commitTransaction');
      expect(result.content[0].text).toBe('Transaction committed');
    });

    it('compile_method forwards args (escaping happens inside the shared query)', async () => {
      vi.mocked(queries.compileMethod).mockReturnValue('Compiled: MyClass >> greeting');
      await server.getTool('compile_method')!.handler({
        className: 'MyClass',
        isMeta: false,
        category: 'testing',
        source: "greeting\n  ^ 'Hello'",
      });

      expect(queries.compileMethod).toHaveBeenCalledWith(
        session, 'MyClass', false, 'testing', "greeting\n  ^ 'Hello'", 0, undefined,
      );
    });

    it('add_dictionary / remove_dictionary / set_class_comment / delete_class / delete_method delegate to queries', async () => {
      vi.mocked(queries.addDictionary).mockReturnValue('Added dictionary: X');
      vi.mocked(queries.removeDictionary).mockReturnValue('Removed dictionary: X');
      vi.mocked(queries.setClassComment).mockReturnValue('Comment set: Foo');
      vi.mocked(queries.deleteClass).mockReturnValue('Deleted class: Foo');
      vi.mocked(queries.deleteMethod).mockReturnValue('Deleted: Foo >> bar');
      vi.mocked(queries.compileClassDefinition).mockReturnValue('Foo');

      const adr = await server.getTool('add_dictionary')!.handler({ dictionaryName: 'X' });
      expect(queries.addDictionary).toHaveBeenCalledWith(session, 'X');
      expect(adr.content[0].text).toBe('Added dictionary: X');

      const rmr = await server.getTool('remove_dictionary')!.handler({ dictionaryName: 'X' });
      expect(queries.removeDictionary).toHaveBeenCalledWith(session, 'X');
      expect(rmr.content[0].text).toBe('Removed dictionary: X');

      await server.getTool('set_class_comment')!.handler({ className: 'Foo', comment: 'hi', dictionaryName: 'Globals' });
      expect(queries.setClassComment).toHaveBeenCalledWith(session, 'Foo', 'hi', 'Globals');

      await server.getTool('delete_class')!.handler({ className: 'Foo', dictionaryName: 'UserGlobals' });
      expect(queries.deleteClass).toHaveBeenCalledWith(session, 'UserGlobals', 'Foo');

      await server.getTool('delete_method')!.handler({ className: 'Foo', isMeta: false, selector: 'bar' });
      expect(queries.deleteMethod).toHaveBeenCalledWith(session, 'Foo', false, 'bar', undefined);

      const ccd = await server.getTool('compile_class_definition')!.handler({ source: "Object subclass: 'Foo'" });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(session, "Object subclass: 'Foo'");
      expect(ccd.content[0].text).toBe('Class: Foo');
    });

    it('run_test_method delegates to sunit.runTestMethod and formats result', async () => {
      vi.mocked(sunit.runTestMethod).mockReturnValue({
        className: 'ArrayTest', selector: 'testSize', status: 'passed', message: '', durationMs: 3,
      });
      const result = await server.getTool('run_test_method')!.handler({
        className: 'ArrayTest',
        selector: 'testSize',
      });

      expect(sunit.runTestMethod).toHaveBeenCalledWith(session, 'ArrayTest', 'testSize');
      expect(result.content[0].text).toBe('PASSED (3ms)');
    });

    it('run_test_class delegates to sunit.runTestClass and formats results', async () => {
      vi.mocked(sunit.runTestClass).mockReturnValue([
        { className: 'ArrayTest', selector: 'testSize', status: 'passed', message: '', durationMs: 0 },
        { className: 'ArrayTest', selector: 'testBad', status: 'failed', message: 'expected 1 got 2', durationMs: 0 },
      ]);
      const result = await server.getTool('run_test_class')!.handler({ className: 'ArrayTest' });

      expect(sunit.runTestClass).toHaveBeenCalledWith(session, 'ArrayTest');
      expect(result.content[0].text).toContain('PASSED: ArrayTest >> testSize');
      expect(result.content[0].text).toContain('FAILED: ArrayTest >> testBad');
      expect(result.content[0].text).toContain('expected 1 got 2');
    });

    it('status pulls session info via executeFetchString', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('User: DataCurator\n...');
      const result = await server.getTool('status')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][2];
      expect(code).toContain('myUserProfile');
      expect(code).toContain('stoneName');
      expect(code).toContain('inTransaction');
      expect(result.content[0].text).toContain('DataCurator');
    });

    it('catches errors from queries and returns isError responses', async () => {
      vi.mocked(queries.executeFetchString).mockImplementation(() => {
        throw new Error('MessageNotUnderstood');
      });
      const result = await server.getTool('execute_code')!.handler({ code: 'bad code' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('MessageNotUnderstood');
    });
  });

  it('picks up session changes between tool calls (no stale caching)', async () => {
    session = undefined;
    const missing = await server.getTool('execute_code')!.handler({ code: '1' });
    expect(missing.isError).toBe(true);

    session = makeSession();
    vi.mocked(queries.executeFetchString).mockReturnValue('1');
    const present = await server.getTool('execute_code')!.handler({ code: '1' });
    expect(present.isError).toBeUndefined();
  });
});
