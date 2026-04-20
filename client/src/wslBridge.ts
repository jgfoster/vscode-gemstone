import { execSync, spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WslInfo {
  available: boolean;
  defaultDistro: string | undefined;
  homeDir: string | undefined;
  /** WSL Linux architecture, e.g. 'x86_64' or 'arm64' (mapped from 'aarch64') */
  arch: string | undefined;
  /** WSL version of the default distro: 1 or 2. GemStone requires 2. */
  wslVersion: number | undefined;
}

let cachedWslInfo: WslInfo | undefined;

/** Returns true if the extension is running on Windows */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/** Returns true if sysadmin commands need WSL bridging */
export function needsWsl(): boolean {
  return isWindows();
}

/**
 * Detect WSL availability and default distro.
 * Caches the result. Call invalidateWslCache() to re-check.
 */
export function getWslInfo(): WslInfo {
  if (cachedWslInfo) return cachedWslInfo;
  if (!isWindows()) {
    cachedWslInfo = { available: false, defaultDistro: undefined, homeDir: undefined, arch: undefined, wslVersion: undefined };
    return cachedWslInfo;
  }
  try {
    const homeOutput = execSync('wsl.exe -e sh -c "echo $HOME"', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    let defaultDistro: string | undefined;
    let wslVersion: number | undefined;
    try {
      // --verbose gives us the default marker (*) and per-distro WSL version (1 or 2)
      const listOutput = execSync('wsl.exe --list --verbose', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // wsl.exe output is UTF-16LE on most Windows builds; strip null bytes
      const lines = listOutput
        .replace(/\0/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      // Find the line marked with '*' (default distro)
      // Format: "* Ubuntu   Running   2"  or  "  Debian   Stopped  1"
      for (const line of lines) {
        const match = line.match(/^\*\s+(\S+)\s+\S+\s+(\d+)/);
        if (match) {
          defaultDistro = match[1];
          wslVersion = parseInt(match[2], 10);
          break;
        }
      }
      // Fall back to first non-header line if no '*' found
      if (!defaultDistro) {
        for (const line of lines) {
          const match = line.match(/^\s*(\S+)\s+\S+\s+(\d+)/);
          if (match && !/^name$/i.test(match[1])) {
            defaultDistro = match[1];
            wslVersion = parseInt(match[2], 10);
            break;
          }
        }
      }
    } catch {
      // wsl --list may fail on older builds; distro name and version will be undefined
    }

    // Detect WSL Linux architecture (aarch64 → arm64, x86_64 stays as-is)
    let arch: string | undefined;
    try {
      const archOutput = execSync('wsl.exe -e sh -c "uname -m"', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      arch = archOutput === 'aarch64' ? 'arm64' : archOutput || undefined;
    } catch {
      // Fall back to undefined; caller will default to x86_64
    }

    cachedWslInfo = {
      available: true,
      defaultDistro,
      homeDir: homeOutput || undefined,
      arch,
      wslVersion,
    };
  } catch (err) {
    console.error('[wslBridge] getWslInfo failed:', err);
    cachedWslInfo = { available: false, defaultDistro: undefined, homeDir: undefined, arch: undefined, wslVersion: undefined };
  }
  return cachedWslInfo;
}

export function invalidateWslCache(): void {
  cachedWslInfo = undefined;
}

/**
 * Parse `wsl.exe --list --verbose` output. Returns the default distro
 * (marked with '*') and its WSL version, or the first non-header row as
 * fallback. Returns an empty object if no rows are present.
 */
function parseWslListOutput(output: string): { distro?: string; version?: number } {
  const lines = output
    .replace(/\0/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  for (const line of lines) {
    const match = line.match(/^\*\s+(\S+)\s+\S+\s+(\d+)/);
    if (match) return { distro: match[1], version: parseInt(match[2], 10) };
  }
  for (const line of lines) {
    const match = line.match(/^\s*(\S+)\s+\S+\s+(\d+)/);
    if (match && !/^name$/i.test(match[1])) {
      return { distro: match[1], version: parseInt(match[2], 10) };
    }
  }
  return {};
}

function normalizeArch(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed === 'aarch64' ? 'arm64' : trimmed;
}

/**
 * Async variant of getWslInfo. Use this during extension activation (and on
 * any re-check) so the extension host event loop isn't blocked by wsl.exe
 * startup — which can take seconds when the WSL2 VM is cold.
 * Shares the same cache as getWslInfo().
 */
export async function getWslInfoAsync(): Promise<WslInfo> {
  if (cachedWslInfo) return cachedWslInfo;
  if (!isWindows()) {
    cachedWslInfo = { available: false, defaultDistro: undefined, homeDir: undefined, arch: undefined, wslVersion: undefined };
    return cachedWslInfo;
  }
  try {
    const { stdout: homeStdout } = await execAsync(
      'wsl.exe -e sh -c "echo $HOME"',
      { timeout: 15000, encoding: 'utf-8' },
    );
    const homeDir = String(homeStdout).trim() || undefined;

    let defaultDistro: string | undefined;
    let wslVersion: number | undefined;
    try {
      const { stdout: listStdout } = await execAsync('wsl.exe --list --verbose', {
        timeout: 10000,
        encoding: 'utf-8',
      });
      const parsed = parseWslListOutput(String(listStdout));
      defaultDistro = parsed.distro;
      wslVersion = parsed.version;
    } catch {
      // wsl --list may fail on older builds; leave undefined
    }

    let arch: string | undefined;
    try {
      const { stdout: archStdout } = await execAsync(
        'wsl.exe -e sh -c "uname -m"',
        { timeout: 10000, encoding: 'utf-8' },
      );
      arch = normalizeArch(String(archStdout));
    } catch {
      // Fall back to undefined; caller will default to x86_64
    }

    cachedWslInfo = {
      available: true,
      defaultDistro,
      homeDir,
      arch,
      wslVersion,
    };
  } catch (err) {
    console.error('[wslBridge] getWslInfoAsync failed:', err);
    cachedWslInfo = { available: false, defaultDistro: undefined, homeDir: undefined, arch: undefined, wslVersion: undefined };
  }
  return cachedWslInfo;
}

/**
 * Convert a WSL-side Linux path to a Windows UNC path.
 * e.g., /home/user/Documents -> \\wsl$\Ubuntu\home\user\Documents
 */
export function wslPathToWindows(wslPath: string, distro?: string): string {
  const info = getWslInfo();
  const d = distro || info.defaultDistro || 'Ubuntu';
  return `\\\\wsl$\\${d}${wslPath.replace(/\//g, '\\')}`;
}

/**
 * Convert a Windows UNC path (\\wsl$\...) back to a WSL Linux path.
 * e.g., \\wsl$\Ubuntu\home\user\Documents -> /home/user/Documents
 */
export function windowsPathToWsl(windowsPath: string): string {
  const match = windowsPath.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(.*)$/i);
  if (match) {
    return match[1].replace(/\\/g, '/');
  }
  return windowsPath;
}

/**
 * Spawn a command, routing through wsl.exe on Windows.
 * On Linux, wraps the command with `ulimit -n 1024` to reset the open-file
 * limit inherited from Electron (~1 billion), which GemStone uses in its
 * shared page cache size calculations.
 * Environment variables are passed via the `env` command inside WSL.
 */
export function wslSpawn(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
): ChildProcess {
  if (needsWsl()) {
    const envPairs = env
      ? Object.entries(env).map(([k, v]) => `${k}=${v}`)
      : [];
    const wslArgs = ['-e', 'env', ...envPairs, cmd, ...args];
    return spawn('wsl.exe', wslArgs, { env: process.env });
  }
  const mergedEnv = { ...process.env, ...env };
  if (process.platform === 'linux') {
    return spawn('/bin/bash', ['-c', 'ulimit -n 1024; exec "$@"', '--', cmd, ...args], { env: mergedEnv });
  }
  return spawn(cmd, args, { env: mergedEnv });
}

/**
 * Execute a command synchronously, routing through wsl.exe on Windows.
 */
export function wslExecSync(
  cmd: string,
  env?: Record<string, string>,
  options?: { timeout?: number },
): string {
  if (!needsWsl()) {
    return execSync(cmd, {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      timeout: options?.timeout,
    });
  }
  const envPrefix = env
    ? Object.entries(env).map(([k, v]) => `${k}='${v}'`).join(' ') + ' '
    : '';
  return execSync(`wsl.exe -e sh -c "${envPrefix}${cmd.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    timeout: options?.timeout,
  });
}
