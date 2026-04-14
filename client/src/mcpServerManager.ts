import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { GemStoneLogin } from './loginTypes';
import { GemStoneDatabase } from './sysadminTypes';
import { SysadminStorage } from './sysadminStorage';
import { LoginStorage } from './loginStorage';
import { appendSysadmin, showSysadmin } from './sysadminChannel';
export interface McpServerInfo {
  process: child_process.ChildProcess;
  port: number;
  login: GemStoneLogin;
  stoneName: string;
}

/** Resolves the GCI library path and GemStone install path for a login. */
function resolveGciAndGsPath(
  login: GemStoneLogin,
  sysadminStorage: SysadminStorage,
  loginStorage: LoginStorage,
): { gciPath: string; gsPath: string } {
  let gciPath = loginStorage.getGciLibraryPath(login.version);
  if (!gciPath) {
    const gsPath = sysadminStorage.getGemstonePath(login.version);
    if (gsPath) {
      const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
      const candidate = path.join(gsPath, 'lib', `libgcits-${login.version}-64.${ext}`);
      if (fs.existsSync(candidate)) {
        gciPath = candidate;
      }
    }
  }
  if (!gciPath) {
    throw new Error(`No GCI library found for GemStone ${login.version}. Configure it in the login settings.`);
  }
  const gsPath = sysadminStorage.getGemstonePath(login.version);
  if (!gsPath) {
    throw new Error(`GemStone ${login.version} not found. Please extract it first.`);
  }
  return { gciPath, gsPath };
}

export class McpServerManager {
  private servers = new Map<string, McpServerInfo>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private extensionPath: string) {}

  // ── SSE server lifecycle (for MCP Inspector, manual exploration) ─────────

  async startServer(
    db: GemStoneDatabase,
    login: GemStoneLogin,
    sysadminStorage: SysadminStorage,
    loginStorage: LoginStorage,
  ): Promise<McpServerInfo> {
    const stoneName = db.config.stoneName;
    if (this.servers.has(stoneName)) {
      throw new Error(`MCP server is already running for ${stoneName}`);
    }

    const { gciPath, gsPath } = resolveGciAndGsPath(login, sysadminStorage, loginStorage);
    const rootPath = sysadminStorage.getRootPath();
    const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
    const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;

    const serverScript = path.join(this.extensionPath, 'mcp-server', 'out', 'index.js');

    const env: Record<string, string | undefined> = {
      ...process.env,
      GS_PASSWORD: login.gs_password,
      HOST_PASSWORD: login.host_password || undefined,
    };

    appendSysadmin(`\n--- Starting MCP Server for ${stoneName} ---`);
    showSysadmin();

    const proc = child_process.spawn('node', [
      serverScript,
      '--transport', 'sse',
      '--library-path', gciPath,
      '--stone-nrs', stoneNrs,
      '--gem-nrs', gemNrs,
      '--gs-user', login.gs_user,
      '--gemstone', gsPath,
      '--gemstone-global-dir', rootPath,
      ...(login.host_user ? ['--host-user', login.host_user] : []),
    ], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stderr?.on('data', (data: Buffer) => {
      appendSysadmin(data.toString().trimEnd());
    });

    const port = await this.waitForPort(proc);

    const info: McpServerInfo = { process: proc, port, login, stoneName };
    this.servers.set(stoneName, info);

    proc.on('exit', (code) => {
      appendSysadmin(`MCP Server for ${stoneName} exited (code ${code})`);
      this.servers.delete(stoneName);
      this._onDidChange.fire();
    });

    return info;
  }

  private waitForPort(proc: child_process.ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let found = false;
      const timeout = setTimeout(() => {
        reject(new Error('MCP server did not report port within 30 seconds'));
      }, 30000);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        // Scan all complete lines for the JSON port message.
        // The GCI library may print diagnostic lines to stdout before ours.
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.substring(0, newlineIndex);
          buffer = buffer.substring(newlineIndex + 1);
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed.port === 'number') {
              found = true;
              proc.stdout?.removeListener('data', onData);
              clearTimeout(timeout);
              resolve(parsed.port);
              return;
            }
          } catch {
            // Not JSON — skip (GCI diagnostic output)
          }
        }
      };

      proc.stdout?.on('data', onData);

      proc.on('error', (err) => {
        if (found) return;
        clearTimeout(timeout);
        reject(new Error(`MCP server process failed: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (found) return;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`MCP server exited with code ${code} before reporting port`));
        }
      });
    });
  }

  async stopServer(stoneName: string): Promise<void> {
    const info = this.servers.get(stoneName);
    if (!info) return;

    appendSysadmin(`\n--- Stopping MCP Server for ${stoneName} ---`);

    info.process.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        info.process.kill('SIGKILL');
        resolve();
      }, 5000);

      info.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.servers.delete(stoneName);
  }

  getServerInfo(stoneName: string): McpServerInfo | undefined {
    return this.servers.get(stoneName);
  }

  isRunning(stoneName: string): boolean {
    return this.servers.has(stoneName);
  }

  dispose(): void {
    for (const info of this.servers.values()) {
      try {
        info.process.kill('SIGTERM');
      } catch { /* ignore */ }
    }
    this.servers.clear();
    this._onDidChange.dispose();
  }

}
