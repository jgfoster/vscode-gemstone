import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpSession } from '../mcpSession';
import { registerTools } from '../tools';

function createMockSession(): McpSession {
  return {
    executeFetchString: vi.fn(() => ''),
    logout: vi.fn(),
  } as unknown as McpSession;
}

interface ToolRegistration {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

function createMockServer() {
  const tools: ToolRegistration[] = [];
  return {
    tool: vi.fn((name: string, description: string, schema: Record<string, unknown>, handler: ToolRegistration['handler']) => {
      tools.push({ name, description, schema, handler });
    }),
    getTools: () => tools,
    getTool: (name: string) => tools.find(t => t.name === name),
  };
}

describe('tools', () => {
  let session: McpSession;
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    session = createMockSession();
    server = createMockServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], session);
  });

  it('registers all expected tools in alphabetical order', () => {
    const toolNames = server.getTools().map(t => t.name);
    const expected = [
      'abort',
      'commit',
      'compile_method',
      'execute_code',
      'find_implementors',
      'find_senders',
      'get_class_definition',
      'get_class_hierarchy',
      'get_method_source',
      'list_classes',
      'list_dictionaries',
      'list_methods',
      'run_test_class',
      'run_test_method',
      'search_method_source',
      'status',
    ];
    expect(toolNames).toEqual(expected);
  });

  describe('execute_code', () => {
    it('executes Smalltalk code and returns result', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('7');
      const tool = server.getTool('execute_code')!;
      const result = await tool.handler({ code: '3 + 4' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('3 + 4');
      expect(code).toContain('printString');
      expect(result.content[0].text).toBe('7');
      expect(result.isError).toBeUndefined();
    });

    it('returns error on GCI failure', async () => {
      vi.mocked(session.executeFetchString).mockImplementation(() => {
        throw new Error('MessageNotUnderstood');
      });
      const tool = server.getTool('execute_code')!;
      const result = await tool.handler({ code: 'bad' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('MessageNotUnderstood');
    });
  });

  describe('get_class_definition', () => {
    it('fetches class definition using className definition', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Array subclass: ...');
      const tool = server.getTool('get_class_definition')!;
      const result = await tool.handler({ className: 'Array' });

      expect(session.executeFetchString).toHaveBeenCalledWith('Array definition');
      expect(result.content[0].text).toBe('Array subclass: ...');
    });
  });

  describe('get_method_source', () => {
    it('fetches instance-side method source', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('printOn: aStream ...');
      const tool = server.getTool('get_method_source')!;
      const result = await tool.handler({
        className: 'Array',
        isMeta: false,
        selector: 'printOn:',
      });

      expect(session.executeFetchString).toHaveBeenCalledWith(
        "(Array compiledMethodAt: #'printOn:') sourceString",
      );
      expect(result.content[0].text).toBe('printOn: aStream ...');
    });

    it('fetches class-side method source', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('new ...');
      const tool = server.getTool('get_method_source')!;
      await tool.handler({
        className: 'Array',
        isMeta: true,
        selector: 'new',
      });

      expect(session.executeFetchString).toHaveBeenCalledWith(
        "(Array class compiledMethodAt: #'new') sourceString",
      );
    });

    it('includes environmentId when specified', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('source');
      const tool = server.getTool('get_method_source')!;
      await tool.handler({
        className: 'Array',
        isMeta: false,
        selector: 'size',
        environmentId: 2,
      });

      expect(session.executeFetchString).toHaveBeenCalledWith(
        "(Array compiledMethodAt: #'size' environmentId: 2) sourceString",
      );
    });
  });

  describe('find_implementors', () => {
    it('calls ClassOrganizer implementorsOf:', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\tArray\t0\tsize\taccessing\n');
      const tool = server.getTool('find_implementors')!;
      const result = await tool.handler({ selector: 'size' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("implementorsOf: #'size'");
      expect(result.content[0].text).toContain('Array');
    });

    it('returns fallback message when no implementors found', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('find_implementors')!;
      const result = await tool.handler({ selector: 'nonexistent' });

      expect(result.content[0].text).toBe('No implementors found.');
    });
  });

  describe('find_senders', () => {
    it('calls ClassOrganizer sendersOf:', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\tString\t0\tprintString\tprinting\n');
      const tool = server.getTool('find_senders')!;
      const result = await tool.handler({ selector: 'printString' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("sendersOf: #'printString'");
      expect(result.content[0].text).toContain('String');
    });
  });

  describe('get_class_hierarchy', () => {
    it('fetches superclasses and subclasses', async () => {
      const hierarchyResult = 'Globals\tObject\tsuperclass\nGlobals\tCollection\tself\nGlobals\tBag\tsubclass\n';
      vi.mocked(session.executeFetchString).mockReturnValue(hierarchyResult);
      const tool = server.getTool('get_class_hierarchy')!;
      const result = await tool.handler({ className: 'Collection' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Collection'");
      expect(result.content[0].text).toContain('Object');
      expect(result.content[0].text).toContain('Bag');
    });
  });

  describe('list_dictionaries', () => {
    it('returns dictionary names', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\nUserGlobals\n');
      const tool = server.getTool('list_dictionaries')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('Globals\nUserGlobals\n');
    });
  });

  describe('list_classes', () => {
    it('lists classes in a dictionary by name', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Array\nString\n');
      const tool = server.getTool('list_classes')!;
      const result = await tool.handler({ dictionaryName: 'Globals' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Globals'");
      expect(result.content[0].text).toBe('Array\nString\n');
    });

    it('escapes single quotes in dictionary name', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_classes')!;
      await tool.handler({ dictionaryName: "it's" });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("it''s");
    });
  });

  describe('list_methods', () => {
    it('lists methods grouped by side and category', async () => {
      const methodList = 'instance\taccessing\tsize\nclass\tcreation\tnew\n';
      vi.mocked(session.executeFetchString).mockReturnValue(methodList);
      const tool = server.getTool('list_methods')!;
      const result = await tool.handler({ className: 'Array' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('Array');
      expect(code).toContain('categoryNames');
      expect(result.content[0].text).toContain('size');
      expect(result.content[0].text).toContain('new');
    });
  });

  describe('compile_method', () => {
    it('compiles an instance-side method', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Compiled successfully: Array >> size');
      const tool = server.getTool('compile_method')!;
      const result = await tool.handler({
        className: 'Array',
        isMeta: false,
        category: 'accessing',
        source: 'size\n  ^ self basicSize',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('Array');
      expect(code).toContain('compileMethod:');
      expect(code).toContain('size');
      expect(code).toContain('accessing');
      expect(result.content[0].text).toContain('Compiled successfully');
    });

    it('compiles a class-side method', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Compiled');
      const tool = server.getTool('compile_method')!;
      await tool.handler({
        className: 'Array',
        isMeta: true,
        category: 'creation',
        source: 'withAll: aCollection\n  ^ self new addAll: aCollection; yourself',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('Array class');
    });

    it('escapes single quotes in source', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Compiled');
      const tool = server.getTool('compile_method')!;
      await tool.handler({
        className: 'MyClass',
        isMeta: false,
        category: 'test',
        source: "greeting\n  ^ 'Hello'",
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("''Hello''");
    });

    it('returns error on compile failure', async () => {
      vi.mocked(session.executeFetchString).mockImplementation(() => {
        throw new Error('Compile error: undefined variable x');
      });
      const tool = server.getTool('compile_method')!;
      const result = await tool.handler({
        className: 'Array',
        isMeta: false,
        category: 'test',
        source: 'bad\n  ^ x',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Compile error');
    });
  });

  describe('abort', () => {
    it('aborts the transaction', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Transaction aborted');
      const tool = server.getTool('abort')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('abortTransaction');
      expect(result.content[0].text).toBe('Transaction aborted');
    });
  });

  describe('commit', () => {
    it('commits the transaction', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Transaction committed');
      const tool = server.getTool('commit')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('commitTransaction');
      expect(result.content[0].text).toBe('Transaction committed');
    });

    it('reports commit failure', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Commit failed — possible conflict. Use abort to reset, then retry.');
      const tool = server.getTool('commit')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Commit failed');
    });
  });

  describe('search_method_source', () => {
    it('searches method source for a substring', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\tArray\t0\tprintOn:\tprinting\n');
      const tool = server.getTool('search_method_source')!;
      const result = await tool.handler({ term: 'printString' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("substringSearch: 'printString'");
      expect(code).toContain('ignoreCase: true');
      expect(result.content[0].text).toContain('Array');
    });

    it('supports case-sensitive search', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('search_method_source')!;
      await tool.handler({ term: 'Foo', ignoreCase: false });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('ignoreCase: false');
    });

    it('returns fallback when no matches found', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('search_method_source')!;
      const result = await tool.handler({ term: 'xyznonexistent' });

      expect(result.content[0].text).toBe('No matches found.');
    });
  });

  describe('run_test_method', () => {
    it('runs a passing test', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('PASSED (12ms)');
      const tool = server.getTool('run_test_method')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testSize' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('ArrayTest');
      expect(code).toContain("selector: #'testSize'");
      expect(result.content[0].text).toContain('PASSED');
    });

    it('returns failure details', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('FAILED: expected 3 got 4 (5ms)');
      const tool = server.getTool('run_test_method')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testBad' });

      expect(result.content[0].text).toContain('FAILED');
      expect(result.content[0].text).toContain('expected 3 got 4');
    });
  });

  describe('run_test_class', () => {
    it('runs all tests in a class and returns results', async () => {
      const output = '3 passed\n\nPASSED: ArrayTest >> testSize\nPASSED: ArrayTest >> testAt\nPASSED: ArrayTest >> testAdd\n';
      vi.mocked(session.executeFetchString).mockReturnValue(output);
      const tool = server.getTool('run_test_class')!;
      const result = await tool.handler({ className: 'ArrayTest' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('ArrayTest suite');
      expect(result.content[0].text).toContain('3 passed');
      expect(result.content[0].text).toContain('testSize');
    });

    it('reports failures and errors', async () => {
      const output = '1 passed, 1 failed\n\nPASSED: MyTest >> testGood\nFAILED: MyTest >> testBad\n  expected 1 got 2\n';
      vi.mocked(session.executeFetchString).mockReturnValue(output);
      const tool = server.getTool('run_test_class')!;
      const result = await tool.handler({ className: 'MyTest' });

      expect(result.content[0].text).toContain('FAILED');
      expect(result.content[0].text).toContain('expected 1 got 2');
    });
  });

  describe('status', () => {
    it('reports session information', async () => {
      const statusOutput = 'User: DataCurator\nStone: gs64stone\nVersion: 3.7.4\nSession ID: 1\nTransaction: active\nDirty objects: 0\n';
      vi.mocked(session.executeFetchString).mockReturnValue(statusOutput);
      const tool = server.getTool('status')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('myUserProfile');
      expect(code).toContain('stoneName');
      expect(code).toContain('inTransaction');
      expect(code).toContain('modifiedObjects');
      expect(result.content[0].text).toContain('DataCurator');
      expect(result.content[0].text).toContain('gs64stone');
    });
  });
});
