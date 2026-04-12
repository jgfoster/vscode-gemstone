import { GciLibrary } from '../../client/src/gciLibrary';
import { OOP_NIL, OOP_ILLEGAL } from '../../client/src/gciConstants';

const MAX_RESULT = 256 * 1024;

export interface McpSessionConfig {
  libraryPath: string;
  stoneNrs: string;
  gemNrs: string;
  gsUser: string;
  gsPassword: string;
  hostUser?: string;
  hostPassword?: string;
}

export class McpSession {
  private gci: GciLibrary;
  private handle: unknown;
  private classUtf8Oop: bigint | undefined;

  constructor(config: McpSessionConfig) {
    this.gci = new GciLibrary(config.libraryPath);
    const result = this.gci.GciTsLogin(
      config.stoneNrs,
      config.hostUser || null,
      config.hostPassword || null,
      false,
      config.gemNrs,
      config.gsUser,
      config.gsPassword,
      0, 0,
    );
    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }
    this.handle = result.session;
  }

  private resolveClassUtf8(): bigint {
    if (this.classUtf8Oop !== undefined) return this.classUtf8Oop;
    const { result, err } = this.gci.GciTsResolveSymbol(this.handle, 'Utf8', OOP_NIL);
    if (err.number !== 0) {
      throw new Error(err.message || 'Cannot resolve Utf8 class');
    }
    this.classUtf8Oop = result;
    return result;
  }

  executeFetchString(code: string): string {
    const oopClassUtf8 = this.resolveClassUtf8();
    const { data, err } = this.gci.GciTsExecuteFetchBytes(
      this.handle,
      code,
      -1,
      oopClassUtf8,
      OOP_ILLEGAL,
      OOP_NIL,
      MAX_RESULT,
    );
    if (err.number !== 0) {
      throw new Error(err.message || `GCI error ${err.number}`);
    }
    return data;
  }

  logout(): void {
    try {
      this.gci.GciTsLogout(this.handle);
    } catch {
      // Session may already be dead
    }
  }
}
