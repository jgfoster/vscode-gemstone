import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
// browserQueries imports sessionManager (vscode) and gciLog (vscode).
// The vscode mock covers that; we mock the specific query functions we rely on.
vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
  implementorsOf: vi.fn(() => [] as unknown[]),
  sendersOf: vi.fn(() => [] as unknown[]),
  getClassDefinition: vi.fn(() => ''),
  getClassHierarchy: vi.fn(() => [] as unknown[]),
  getMethodSource: vi.fn(() => ''),
  getMethodList: vi.fn(() => [] as unknown[]),
  getDictionaryNames: vi.fn(() => [] as string[]),
  getClassNames: vi.fn(() => [] as string[]),
  searchMethodSource: vi.fn(() => [] as unknown[]),
}));

import * as queries from '../browserQueries';
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

  it('registers the expected 16 tools in alphabetical order', () => {
    const names = server.getToolNames();
    expect(names).toEqual([
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

    it('list_classes resolves dictionary name to index', async () => {
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['Globals', 'UserGlobals']);
      vi.mocked(queries.getClassNames).mockReturnValue(['Array', 'String']);
      const result = await server.getTool('list_classes')!.handler({ dictionaryName: 'UserGlobals' });

      expect(queries.getClassNames).toHaveBeenCalledWith(session, 2); // 1-based
      expect(result.content[0].text).toBe('Array\nString');
    });

    it('list_classes reports unknown dictionary', async () => {
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['Globals']);
      const result = await server.getTool('list_classes')!.handler({ dictionaryName: 'Missing' });

      expect(result.content[0].text).toBe('Dictionary not found: Missing');
      expect(queries.getClassNames).not.toHaveBeenCalled();
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

    it('compile_method escapes quotes in source', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('Compiled successfully: MyClass >> greeting');
      await server.getTool('compile_method')!.handler({
        className: 'MyClass',
        isMeta: false,
        category: 'testing',
        source: "greeting\n  ^ 'Hello'",
      });

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][2];
      expect(code).toContain("''Hello''");
      expect(code).toContain('compileMethod:');
    });

    it('run_test_method uses TestCase selector:', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('PASSED (3ms)');
      await server.getTool('run_test_method')!.handler({
        className: 'ArrayTest',
        selector: 'testSize',
      });

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][2];
      expect(code).toContain('ArrayTest');
      expect(code).toContain("selector: #'testSize'");
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
