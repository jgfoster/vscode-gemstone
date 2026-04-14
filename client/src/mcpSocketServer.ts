import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ActiveSession } from './sessionManager';
import { registerMcpTools } from './mcpTools';
import { appendSysadmin } from './sysadminChannel';

export interface McpSocketServerOptions {
  /** Returns the user's currently selected GemStone session, or undefined. */
  getSession: () => ActiveSession | undefined;
  /**
   * Stable identifier for the workspace. Used to derive a socket path so
   * multiple windows/workspaces don't collide. Falls back to a random value
   * if not provided.
   */
  workspaceKey?: string;
}

/**
 * Derive the socket / named-pipe path for a given workspace. Stable across
 * restarts so Claude Code (which writes the path into `.claude/settings.local.json`)
 * keeps working without re-configuration.
 */
export function socketPathFor(workspaceKey: string): string {
  const hash = crypto.createHash('sha1').update(workspaceKey).digest('hex').slice(0, 10);
  if (process.platform === 'win32') {
    // Named pipe
    return `\\\\.\\pipe\\jasper-mcp-${hash}`;
  }
  return path.join(os.tmpdir(), `jasper-mcp-${hash}.sock`);
}

/**
 * A Unix socket / named-pipe server that speaks the MCP protocol. Each
 * incoming connection gets its own McpServer instance bound to Jasper's
 * current selected session via {@link registerMcpTools}.
 *
 * The spawned thin proxy (in mcp-server/out/index.js --proxy-socket …)
 * connects here; Claude Code's stdio is piped through the proxy into this
 * socket. Tools therefore run inside the extension host against the user's
 * live GCI session.
 */
export class McpSocketServer {
  private server: net.Server | undefined;
  readonly socketPath: string;

  constructor(private options: McpSocketServerOptions) {
    const key = options.workspaceKey ?? crypto.randomBytes(8).toString('hex');
    this.socketPath = socketPathFor(key);
  }

  async start(): Promise<void> {
    // Remove any stale socket from a previous run (Unix only; named pipes are
    // automatically cleaned up by the OS when the owning process exits).
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch { /* ignore */ }
    }

    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    appendSysadmin(`MCP socket listening at ${this.socketPath}`);
  }

  private handleConnection(socket: net.Socket): void {
    appendSysadmin('MCP client connected');
    const mcpServer = new McpServer({ name: 'gemstone', version: '1.0.0' });
    registerMcpTools(mcpServer, this.options.getSession);

    // StdioServerTransport reads from an input stream and writes to an output
    // stream. net.Socket is both, so we use it as both ends.
    const transport = new StdioServerTransport(socket, socket);
    mcpServer.connect(transport).catch((err) => {
      appendSysadmin(`MCP connection error: ${(err as Error).message}`);
      socket.destroy();
    });

    socket.on('close', () => {
      appendSysadmin('MCP client disconnected');
    });

    socket.on('error', (err) => {
      appendSysadmin(`MCP socket error: ${err.message}`);
    });
  }

  async dispose(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch { /* ignore */ }
    }
  }
}

/**
 * Write the Claude Code MCP config into the workspace's
 * `.claude/settings.local.json`, pointing at the proxy script with the
 * given socket path. Preserves other entries in the file.
 */
export function writeClaudeCodeMcpConfig(
  workspaceRoot: string,
  extensionPath: string,
  socketPath: string,
): string {
  const claudeDir = path.join(workspaceRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch { /* ignore; start fresh */ }
  }

  const proxyScript = path.join(extensionPath, 'mcp-server', 'out', 'index.js');
  const desired = {
    command: 'node',
    args: [proxyScript, '--proxy-socket', socketPath],
  };

  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  // Only rewrite if the entry is missing or has changed — avoids unnecessary
  // churn when the user has the file open.
  const current = mcpServers['gemstone'];
  if (JSON.stringify(current) !== JSON.stringify(desired)) {
    mcpServers['gemstone'] = desired;
    settings.mcpServers = mcpServers;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
  return settingsPath;
}
