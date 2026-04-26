import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
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

function workspaceHash(workspaceKey: string): string {
  return crypto.createHash('sha1').update(workspaceKey).digest('hex').slice(0, 10);
}

/**
 * Derive the socket / named-pipe path for a given workspace. Stable across
 * restarts so registered MCP entries (written into `~/.claude.json` by
 * `claude mcp add` and into `claude_desktop_config.json` by this module)
 * keep working without re-configuration.
 */
export function socketPathFor(workspaceKey: string): string {
  const hash = workspaceHash(workspaceKey);
  if (process.platform === 'win32') {
    // Named pipe
    return `\\\\.\\pipe\\jasper-mcp-${hash}`;
  }
  return path.join(os.tmpdir(), `jasper-mcp-${hash}.sock`);
}

/**
 * Name under which the MCP server is registered with Claude Desktop. Desktop
 * has a single global config file, so we namespace by workspace to let
 * multiple open VS Code windows coexist without clobbering each other.
 */
export function mcpServerNameFor(workspaceKey: string): string {
  return `gemstone-${workspaceHash(workspaceKey)}`;
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

/** Absolute path to the stdio proxy script shipped in the extension. */
export function proxyScriptPath(extensionPath: string): string {
  return path.join(extensionPath, 'mcp-server', 'out', 'index.js');
}

/**
 * Platform-specific path for Claude Desktop's MCP config. Desktop has a
 * single global config file (no per-project or CLI-based registration path
 * like Claude Code), so a VS Code extension has to write it directly.
 */
export function claudeDesktopConfigPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

interface ClaudeDesktopSettings {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readDesktopSettings(configPath: string): ClaudeDesktopSettings {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Corrupt or unreadable — treat as empty so we don't destroy user content
    // beyond the mcpServers entry we own. The subsequent write will recreate
    // the file with our entry plus whatever survived parsing (i.e. nothing).
    return {};
  }
}

function writeDesktopSettings(configPath: string, settings: ClaudeDesktopSettings): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Merge a per-workspace `gemstone-<hash>` entry into Claude Desktop's global
 * config, pointing at the proxy script with the given socket path. Preserves
 * other entries (including gemstone-<hash> entries from other workspaces).
 * Returns the config path that was written (or would have been written).
 */
export function writeClaudeDesktopMcpConfig(
  workspaceKey: string,
  extensionPath: string,
  socketPath: string,
): string {
  const configPath = claudeDesktopConfigPath();
  const settings = readDesktopSettings(configPath);

  const desired = {
    command: 'node',
    args: [proxyScriptPath(extensionPath), '--proxy-socket', socketPath],
  };

  const name = mcpServerNameFor(workspaceKey);
  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  const current = mcpServers[name];
  if (JSON.stringify(current) !== JSON.stringify(desired)) {
    mcpServers[name] = desired;
    settings.mcpServers = mcpServers;
    writeDesktopSettings(configPath, settings);
  }
  return configPath;
}

/**
 * Remove this workspace's `gemstone-<hash>` entry from Claude Desktop's
 * config. Called on extension deactivation so Desktop doesn't keep trying to
 * launch a proxy against a dead socket. No-ops if the file or entry is
 * absent.
 */
export function removeClaudeDesktopMcpConfig(workspaceKey: string): void {
  const configPath = claudeDesktopConfigPath();
  if (!fs.existsSync(configPath)) return;
  const settings = readDesktopSettings(configPath);
  const mcpServers = settings.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers) return;
  const name = mcpServerNameFor(workspaceKey);
  if (!(name in mcpServers)) return;
  delete mcpServers[name];
  settings.mcpServers = mcpServers;
  writeDesktopSettings(configPath, settings);
}
