import { execFile, ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import { appendSysadmin } from './sysadminChannel';

export type CommandResult = { stdout: string; stderr: string };

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string },
) => Promise<CommandResult>;

const execFileAsync = promisify(execFile);

/**
 * Default runner — shells out to the `claude` CLI. Uses `shell: true` on
 * Windows so the `.cmd` shim installed by npm is resolvable; on Unix, argv is
 * passed directly with no shell interpolation.
 */
const defaultRunner: CommandRunner = async (command, args, options) => {
  const execOptions: ExecFileOptions = {
    cwd: options.cwd,
    shell: process.platform === 'win32',
  };
  const { stdout, stderr } = await execFileAsync(command, args, execOptions);
  return { stdout: String(stdout), stderr: String(stderr) };
};

export interface McpRegistrar {
  register(name: string, command: string, args: string[]): Promise<boolean>;
  unregister(name: string): Promise<boolean>;
}

/**
 * Registers/unregisters MCP servers with Claude Code by calling `claude mcp
 * add/remove`. The CLI writes into `~/.claude.json` under the project's local
 * scope, which is what Claude Code actually reads — unlike
 * `.claude/settings.local.json`, which only holds permissions/hooks/env.
 *
 * If `claude` is not on PATH, operations log a note and return `false`;
 * callers should treat the MCP integration as optional.
 */
export class ClaudeCliRegistrar implements McpRegistrar {
  constructor(
    private readonly cwd: string,
    private readonly runner: CommandRunner = defaultRunner,
  ) {}

  async register(name: string, command: string, args: string[]): Promise<boolean> {
    try {
      // Remove any stale entry first: `claude mcp add` fails if the name
      // already exists, and the socket path may have changed since last run.
      await this.runner('claude', ['mcp', 'remove', name], { cwd: this.cwd })
        .catch(() => undefined);
      await this.runner(
        'claude',
        ['mcp', 'add', name, '--', command, ...args],
        { cwd: this.cwd },
      );
      appendSysadmin(`Registered '${name}' MCP server with Claude Code`);
      return true;
    } catch (err) {
      appendSysadmin(describeFailure('register', name, err));
      return false;
    }
  }

  async unregister(name: string): Promise<boolean> {
    try {
      await this.runner('claude', ['mcp', 'remove', name], { cwd: this.cwd });
      appendSysadmin(`Unregistered '${name}' MCP server from Claude Code`);
      return true;
    } catch (err) {
      if (isMissingClaudeCli(err)) {
        appendSysadmin(describeFailure('unregister', name, err));
      }
      // A missing entry is not worth surfacing — it's the desired end state.
      return false;
    }
  }
}

function isMissingClaudeCli(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const msg = ((err as { message?: string }).message ?? '').toLowerCase();
  return code === 'ENOENT' || msg.includes('not found') || msg.includes('command not found');
}

function describeFailure(verb: string, name: string, err: unknown): string {
  if (isMissingClaudeCli(err)) {
    return `Could not ${verb} '${name}' with Claude Code: 'claude' CLI not on PATH`;
  }
  const msg = (err as { message?: string }).message ?? String(err);
  return `Could not ${verb} '${name}' with Claude Code: ${msg}`;
}
