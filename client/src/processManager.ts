import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync, spawn } from 'child_process';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { appendSysadmin, showSysadmin } from './sysadminChannel';

export class ProcessManager {
  private cachedProcesses: GemStoneProcess[] = [];

  constructor(private storage: SysadminStorage) {}

  getProcesses(): GemStoneProcess[] {
    return this.cachedProcesses;
  }

  /** Run gslist -cvl and parse output */
  refreshProcesses(): GemStoneProcess[] {
    const gslistPath = this.findGslist();
    if (!gslistPath) {
      this.cachedProcesses = [];
      return [];
    }
    try {
      const gsPath = path.dirname(path.dirname(gslistPath));
      const env: Record<string, string | undefined> = {
        ...process.env,
        GEMSTONE: gsPath,
        PATH: `${path.dirname(gslistPath)}:${process.env.PATH}`,
        GEMSTONE_GLOBAL_DIR: this.storage.getRootPath(),
      };
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = `${path.join(gsPath, 'lib')}:${process.env.DYLD_LIBRARY_PATH || ''}`;
      } else {
        env.LD_LIBRARY_PATH = `${path.join(gsPath, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}`;
      }
      const output = execSync(`"${gslistPath}" -cvl`, { encoding: 'utf-8', env });
      this.cachedProcesses = this.parseGslist(output);
    } catch {
      this.cachedProcesses = [];
    }
    return this.cachedProcesses;
  }

  private parseGslist(output: string): GemStoneProcess[] {
    const processes: GemStoneProcess[] = [];
    for (const line of output.split('\n')) {
      // Format: OK  {version}  {owner}  {pid} {port} {month} {day} {time} {type}  {name}
      const match = line.match(
        /^OK\s+([\d.]+)\s+\S+\s+(\d+)\s+(\d+)\s+(\w+\s+\d+\s+[\d:]+)\s+(Stone|Netldi)\s+(.+)$/i,
      );
      if (match) {
        const typeLower = match[5].toLowerCase();
        if (typeLower !== 'stone' && typeLower !== 'netldi') continue;
        const type = typeLower === 'stone' ? 'stone' : 'netldi';
        const proc: GemStoneProcess = {
          type,
          version: match[1],
          pid: parseInt(match[2], 10),
          name: match[6].trim(),
          startTime: match[4],
        };
        if (type === 'netldi') {
          proc.port = parseInt(match[3], 10);
        }
        processes.push(proc);
      }
    }
    return processes;
  }

  private findGslist(): string | undefined {
    // Look for gslist in any extracted version
    const versions = this.storage.getExtractedVersions();
    for (const version of versions) {
      const gsPath = this.storage.getGemstonePath(version);
      if (gsPath) {
        const gslistPath = path.join(gsPath, 'bin', 'gslist');
        try {
          execSync(`test -x "${gslistPath}"`);
          return gslistPath;
        } catch {
          continue;
        }
      }
    }
    return undefined;
  }

  private getEnvironment(db: GemStoneDatabase): Record<string, string> {
    const gsPath = this.storage.getGemstonePath(db.config.version);
    if (!gsPath) throw new Error(`GemStone ${db.config.version} not found. Please extract it first.`);
    const env: Record<string, string> = {
      GEMSTONE: gsPath,
      GEMSTONE_SYS_CONF: path.join(db.path, 'conf'),
      GEMSTONE_GLOBAL_DIR: this.storage.getRootPath(),
      GEMSTONE_LOG: path.join(db.path, 'log', `${db.config.stoneName}.log`),
      GEMSTONE_EXE_CONF: path.join(db.path, 'conf'),
      GEMSTONE_NRS_ALL: `#netldi:${db.config.ldiName}#dir:${db.path}#log:${db.path}/log/%N_%P.log`,
      PATH: `${path.join(gsPath, 'bin')}:${process.env.PATH || ''}`,
    };
    if (process.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = `${path.join(gsPath, 'lib')}:${process.env.DYLD_LIBRARY_PATH || ''}`;
    } else {
      env.LD_LIBRARY_PATH = `${path.join(gsPath, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}`;
    }
    env.MANPATH = `${path.join(gsPath, 'doc')}:${process.env.MANPATH || ''}`;
    return env;
  }

  /** Start a stone */
  async startStone(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    const logPath = path.join(db.path, 'log', `${db.config.stoneName}.log`);
    return this.runCommand(
      path.join(gsPath, 'bin', 'startstone'),
      ['-l', logPath, db.config.stoneName],
      env,
      `Starting stone ${db.config.stoneName}`,
    );
  }

  /** Stop a stone */
  async stopStone(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    return this.runCommand(
      path.join(gsPath, 'bin', 'stopstone'),
      [db.config.stoneName, 'DataCurator', 'swordfish'],
      env,
      `Stopping stone ${db.config.stoneName}`,
    );
  }

  /** Start NetLDI */
  async startNetldi(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    const logPath = path.join(db.path, 'log', `${db.config.ldiName}.log`);
    const user = os.userInfo().username;
    return this.runCommand(
      path.join(gsPath, 'bin', 'startnetldi'),
      ['-a', user, '-g', '-l', logPath, db.config.ldiName],
      env,
      `Starting NetLDI ${db.config.ldiName}`,
    );
  }

  /** Stop NetLDI */
  async stopNetldi(db: GemStoneDatabase): Promise<string> {
    const env = this.getEnvironment(db);
    const gsPath = env.GEMSTONE;
    return this.runCommand(
      path.join(gsPath, 'bin', 'stopnetldi'),
      [db.config.ldiName],
      env,
      `Stopping NetLDI ${db.config.ldiName}`,
    );
  }

  /** Open a terminal with GemStone environment */
  openTerminal(db: GemStoneDatabase): void {
    const env = this.getEnvironment(db);
    const terminal = vscode.window.createTerminal({
      name: `GemStone: ${db.config.stoneName}`,
      env,
      cwd: db.path,
    });
    terminal.show();
  }

  private runCommand(
    cmd: string,
    args: string[],
    env: Record<string, string>,
    label: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      appendSysadmin(`\n--- ${label} ---`);
      showSysadmin();
      // On Linux, VSCode's Electron process inherits an enormous open-file limit
      // (~1 billion) which GemStone uses in its internal size calculations for
      // the shared page cache. Reset it to the typical Linux default (1024) so
      // GemStone behaves as it would when launched from a normal terminal.
      const proc = process.platform === 'linux'
        ? spawn('/bin/bash', ['-c', 'ulimit -n 1024; exec "$@"', '--', cmd, ...args], { env })
        : spawn(cmd, args, { env });
      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        appendSysadmin(text.trimEnd());
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        appendSysadmin(text.trimEnd());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`${label} failed (exit code ${code})\n${output}`));
        } else {
          resolve(output);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`${label} failed: ${err.message}`));
      });
    });
  }

  /** Check if a stone is running */
  isStoneRunning(stoneName: string): boolean {
    return this.cachedProcesses.some(p => p.type === 'stone' && p.name === stoneName);
  }

  /** Check if a netldi is running */
  isNetldiRunning(ldiName: string): boolean {
    return this.cachedProcesses.some(p => p.type === 'netldi' && p.name === ldiName);
  }
}
