import { execSync, spawn, ChildProcess } from 'child_process';

export interface WslInfo {
  available: boolean;
  defaultDistro: string | undefined;
  homeDir: string | undefined;
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
    cachedWslInfo = { available: false, defaultDistro: undefined, homeDir: undefined };
    return cachedWslInfo;
  }
  try {
    const homeOutput = execSync('wsl.exe -e sh -c "echo $HOME"', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    let defaultDistro: string | undefined;
    try {
      const listOutput = execSync('wsl.exe --list --quiet', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // wsl.exe --list may output UTF-16LE on some Windows versions
      const lines = listOutput
        .replace(/\0/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      defaultDistro = lines[0];
    } catch {
      // wsl --list may fail on older builds
    }

    cachedWslInfo = {
      available: true,
      defaultDistro,
      homeDir: homeOutput || undefined,
    };
  } catch {
    cachedWslInfo = { available: false, defaultDistro: undefined, homeDir: undefined };
  }
  return cachedWslInfo;
}

export function invalidateWslCache(): void {
  cachedWslInfo = undefined;
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
  const match = windowsPath.match(/^\\\\wsl\$\\[^\\]+(.*)$/);
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
