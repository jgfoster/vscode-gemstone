import * as vscode from 'vscode';

export interface OpenMcpInspectorOptions {
  /** Path to a PEM cert Node should trust in addition to its built-in CA
   *  bundle. Needed when the MCP server presents a self-signed cert: macOS's
   *  keychain trust doesn't apply to Node's TLS stack, so we wire the cert in
   *  via `NODE_EXTRA_CA_CERTS` on the terminal's environment. */
  extraCaCertPath?: string;
}

/**
 * Launch MCP Inspector against the given MCP server URL in a dedicated
 * terminal. Reuses a single terminal so repeat invocations don't stack up
 * orphaned Inspector processes. Returns the terminal so the caller can track
 * its lifecycle.
 *
 * Windows PowerShell's default ExecutionPolicy blocks `npx` (.ps1); invoking
 * `npx.cmd` goes through CreateProcess directly and works regardless.
 */
export function openMcpInspector(
  url: string,
  state: { terminal: vscode.Terminal | undefined },
  options: OpenMcpInspectorOptions = {},
): vscode.Terminal {
  state.terminal?.dispose();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const env: Record<string, string> = {};
  if (options.extraCaCertPath) {
    env.NODE_EXTRA_CA_CERTS = options.extraCaCertPath;
  }
  const terminal = vscode.window.createTerminal({
    name: 'MCP Inspector',
    env: Object.keys(env).length > 0 ? env : undefined,
  });
  state.terminal = terminal;
  terminal.show();
  terminal.sendText(
    `${npx} @modelcontextprotocol/inspector --transport sse --server-url ${url}`,
  );
  return terminal;
}
