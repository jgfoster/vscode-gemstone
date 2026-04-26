import { McpRegistrar } from './claudeCodeMcpRegistration';

export interface SocketServerHandle {
  readonly socketPath: string;
  dispose(): Promise<void>;
}

export interface ClaudeCodeMcpLifecycleOptions {
  /** Name under which the MCP server is registered with Claude Code. */
  serverName: string;
  /** Executable that Claude Code should spawn (typically `'node'`). */
  proxyCommand: string;
  /**
   * Base args for the proxy command. The socket path is appended as
   * `--proxy-socket <path>` once the socket is listening.
   */
  proxyArgs: string[];
  /** Starts a new socket server; called when the first session becomes active. */
  startSocket: () => Promise<SocketServerHandle>;
  registrar: McpRegistrar;
}

/**
 * Manages the Claude Code MCP integration across the extension's lifetime:
 * opens the socket and registers the server via `claude mcp add` on start,
 * and unregisters + closes the socket on dispose.
 *
 * The MCP server is always present once the extension activates — tool calls
 * receive a clean "No active GemStone session" error when the user hasn't
 * logged in, rather than the server disappearing from Claude Code's view.
 */
export class ClaudeCodeMcpLifecycle {
  private handle: SocketServerHandle | undefined;
  private registered = false;

  constructor(private readonly options: ClaudeCodeMcpLifecycleOptions) {}

  get isActive(): boolean {
    return this.handle !== undefined;
  }

  async start(): Promise<void> {
    if (this.handle) return;
    this.handle = await this.options.startSocket();
    const args = [...this.options.proxyArgs, '--proxy-socket', this.handle.socketPath];
    this.registered = await this.options.registrar.register(
      this.options.serverName,
      this.options.proxyCommand,
      args,
    );
  }

  async dispose(): Promise<void> {
    if (!this.handle) return;
    if (this.registered) {
      await this.options.registrar.unregister(this.options.serverName);
      this.registered = false;
    }
    await this.handle.dispose();
    this.handle = undefined;
  }
}
