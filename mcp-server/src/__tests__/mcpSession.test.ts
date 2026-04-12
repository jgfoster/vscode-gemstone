import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('koffi', () => ({
  default: {
    struct: vi.fn(() => ({})),
    array: vi.fn(() => ({})),
    opaque: vi.fn(() => ({})),
    pointer: vi.fn(() => ({})),
    union: vi.fn(() => ({})),
    load: vi.fn(() => ({
      func: vi.fn(() => vi.fn()),
    })),
  },
}));

vi.mock('../../../client/src/gciLibrary', () => {
  return {
    GciLibrary: vi.fn(),
  };
});

vi.mock('../../../client/src/gciConstants', () => ({
  OOP_NIL: 0x14n,
  OOP_ILLEGAL: 0x01n,
}));

import { McpSession, McpSessionConfig } from '../mcpSession';
import { GciLibrary } from '../../../client/src/gciLibrary';

const noErr = {
  number: 0,
  message: '',
  context: 0n,
  category: 0n,
  fatal: 0,
  argCount: 0,
  exceptionObj: 0n,
  args: [],
  reason: '',
};

function makeConfig(overrides: Partial<McpSessionConfig> = {}): McpSessionConfig {
  return {
    libraryPath: '/path/to/libgcirpc.dylib',
    stoneNrs: '!tcp@localhost#server!gs64stone',
    gemNrs: '!tcp@localhost#netldi:gs64ldi#task!gemnetobject',
    gsUser: 'DataCurator',
    gsPassword: 'swordfish',
    ...overrides,
  };
}

function createMockGci() {
  return {
    GciTsLogin: vi.fn(() => ({ session: {} as unknown, err: { ...noErr } })),
    GciTsLogout: vi.fn(() => ({ err: { ...noErr } })),
    GciTsResolveSymbol: vi.fn(() => ({ result: 1000n, err: { ...noErr } })),
    GciTsExecuteFetchBytes: vi.fn(() => ({ data: 'result', bytesReturned: 6, err: { ...noErr } })),
  };
}

describe('McpSession', () => {
  let mockGci: ReturnType<typeof createMockGci>;

  beforeEach(() => {
    mockGci = createMockGci();
    vi.mocked(GciLibrary).mockImplementation(() => mockGci as unknown as GciLibrary);
  });

  describe('constructor', () => {
    it('creates a GCI library and logs in', () => {
      const config = makeConfig();
      new McpSession(config);

      expect(GciLibrary).toHaveBeenCalledWith(config.libraryPath);
      expect(mockGci.GciTsLogin).toHaveBeenCalledWith(
        config.stoneNrs,
        null,
        null,
        false,
        config.gemNrs,
        config.gsUser,
        config.gsPassword,
        0, 0,
      );
    });

    it('passes host credentials when provided', () => {
      const config = makeConfig({ hostUser: 'admin', hostPassword: 'secret' });
      new McpSession(config);

      expect(mockGci.GciTsLogin).toHaveBeenCalledWith(
        config.stoneNrs,
        'admin',
        'secret',
        false,
        config.gemNrs,
        config.gsUser,
        config.gsPassword,
        0, 0,
      );
    });

    it('throws on login failure', () => {
      mockGci.GciTsLogin.mockReturnValue({
        session: null,
        err: { ...noErr, number: 4065, message: 'Login failed: bad password' },
      });

      expect(() => new McpSession(makeConfig())).toThrow('Login failed: bad password');
    });
  });

  describe('executeFetchString', () => {
    it('resolves Utf8 class and executes code', () => {
      const session = new McpSession(makeConfig());
      const result = session.executeFetchString('3 + 4');

      expect(mockGci.GciTsResolveSymbol).toHaveBeenCalled();
      expect(mockGci.GciTsExecuteFetchBytes).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('caches the Utf8 class OOP across calls', () => {
      const session = new McpSession(makeConfig());

      session.executeFetchString('1 + 1');
      session.executeFetchString('2 + 2');

      expect(mockGci.GciTsResolveSymbol).toHaveBeenCalledTimes(1);
      expect(mockGci.GciTsExecuteFetchBytes).toHaveBeenCalledTimes(2);
    });

    it('throws on GCI execution error', () => {
      const session = new McpSession(makeConfig());
      mockGci.GciTsExecuteFetchBytes.mockReturnValue({
        data: '',
        bytesReturned: 0,
        err: { ...noErr, number: 2101, message: 'MessageNotUnderstood' },
      });

      expect(() => session.executeFetchString('bad code')).toThrow('MessageNotUnderstood');
    });

    it('throws on Utf8 resolve failure', () => {
      mockGci.GciTsResolveSymbol.mockReturnValue({
        result: 0n,
        err: { ...noErr, number: 2023, message: 'symbol not found' },
      });

      const session = new McpSession(makeConfig());
      expect(() => session.executeFetchString('anything')).toThrow('symbol not found');
    });
  });

  describe('logout', () => {
    it('calls GciTsLogout', () => {
      const session = new McpSession(makeConfig());
      session.logout();

      expect(mockGci.GciTsLogout).toHaveBeenCalled();
    });

    it('does not throw if logout fails', () => {
      mockGci.GciTsLogout.mockImplementation(() => {
        throw new Error('session already dead');
      });

      const session = new McpSession(makeConfig());
      expect(() => session.logout()).not.toThrow();
    });
  });
});
