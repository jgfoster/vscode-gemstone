import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from './sysadminStorage';
import { ProcessManager } from './processManager';
import { GemStoneDatabase } from './sysadminTypes';
import { appendSysadmin } from './sysadminChannel';

export class DatabaseManager {
  constructor(
    private storage: SysadminStorage,
    private processManager: ProcessManager,
  ) {}

  /** Create a new database via multi-step QuickPick */
  async createDatabase(): Promise<GemStoneDatabase | undefined> {
    // Step 1: Pick extracted version
    const versions = this.storage.getExtractedVersions();
    if (versions.length === 0) {
      vscode.window.showErrorMessage('No GemStone versions extracted. Download and extract a version first.');
      return undefined;
    }
    const versionPick = await vscode.window.showQuickPick(
      versions.map(v => ({ label: v })),
      { placeHolder: 'Select GemStone version', title: 'New GemStone Database (1/4)' },
    );
    if (!versionPick) return undefined;
    const version = versionPick.label;

    // Step 2: Pick base extent
    const extents = this.storage.getAvailableExtents(version);
    if (extents.length === 0) {
      vscode.window.showErrorMessage(`No extent files found for version ${version}.`);
      return undefined;
    }
    const extentPick = await vscode.window.showQuickPick(
      extents.map(e => ({ label: e })),
      { placeHolder: 'Select base extent', title: 'New GemStone Database (2/4)' },
    );
    if (!extentPick) return undefined;
    const baseExtent = extentPick.label;

    // Step 3: Stone name
    const stoneName = await vscode.window.showInputBox({
      prompt: 'Stone name',
      value: 'gs64stone',
      title: 'New GemStone Database (3/4)',
      validateInput: (v) => /^\w+$/.test(v) ? null : 'Alphanumeric and underscore only',
    });
    if (!stoneName) return undefined;

    // Step 4: NetLDI name
    const ldiName = await vscode.window.showInputBox({
      prompt: 'NetLDI name',
      value: 'gs64ldi',
      title: 'New GemStone Database (4/4)',
      validateInput: (v) => /^\w+$/.test(v) ? null : 'Alphanumeric and underscore only',
    });
    if (!ldiName) return undefined;

    // Create directory structure
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating GemStone database...' },
      async (progress) => {
        this.storage.ensureRootPath();
        const dbNum = this.storage.getNextDbNumber();
        const dbDir = path.join(this.storage.getRootPath(), `db-${dbNum}`);

        progress.report({ message: 'Creating directories...' });
        fs.mkdirSync(dbDir);
        fs.mkdirSync(path.join(dbDir, 'conf'));
        fs.mkdirSync(path.join(dbDir, 'data'));
        fs.mkdirSync(path.join(dbDir, 'log'));
        fs.mkdirSync(path.join(dbDir, 'stat'));

        progress.report({ message: 'Writing configuration...' });

        // database.yaml
        fs.writeFileSync(path.join(dbDir, 'database.yaml'),
          `---\nbaseExtent: "${baseExtent}.dbf"\nldiName: "${ldiName}"\nstoneName: "${stoneName}"\nversion: "${version}"\n`);

        // gem.conf
        fs.writeFileSync(path.join(dbDir, 'conf', 'gem.conf'),
          `# Edit this file to change your gem or topaz configuration\n\n` +
          `GEM_TEMPOBJ_CACHE_SIZE = 50000;\n` +
          `GEM_TEMPOBJ_POMGEN_PRUNE_ON_VOTE = 90;\n\n` +
          `# Set the following to FALSE if you get an error\n` +
          `# related to native code when stepping in the debugger\n` +
          `GEM_NATIVE_CODE_ENABLED = TRUE;\n`);

        // stoneName.conf
        fs.writeFileSync(path.join(dbDir, 'conf', `${stoneName}.conf`),
          `# Edit this file to change your stone configuration.\n` +
          `# For example, you might want a larger Shared Page Cache.\n\n` +
          `SHR_PAGE_CACHE_SIZE_KB = 100000;\n` +
          `KEYFILE = "${dbDir}/conf/gemstone.key";\n`);

        // system.conf
        fs.writeFileSync(path.join(dbDir, 'conf', 'system.conf'),
          `# See $GEMSTONE/data/system.conf for descriptions of these lines.\n` +
          `# In general, this file should not be edited.\n` +
          `# You may customize the stone config file (stonename.conf) or gem.conf\n\n` +
          `DBF_EXTENT_NAMES = "${dbDir}/data/extent0.dbf";\n` +
          `STN_TRAN_FULL_LOGGING = TRUE;\n` +
          `STN_TRAN_LOG_DIRECTORIES = "${dbDir}/data/";\n` +
          `STN_TRAN_LOG_SIZES = 1000;\n`);

        progress.report({ message: 'Copying key file...' });
        const gsPath = this.storage.getGemstonePath(version)!;
        const keySource = path.join(gsPath, 'sys', 'community.starter.key');
        if (fs.existsSync(keySource)) {
          fs.copyFileSync(keySource, path.join(dbDir, 'conf', 'gemstone.key'));
        }

        progress.report({ message: 'Copying base extent (this may take a moment)...' });
        const extentSource = path.join(gsPath, 'bin', `${baseExtent}.dbf`);
        const extentDest = path.join(dbDir, 'data', 'extent0.dbf');
        fs.copyFileSync(extentSource, extentDest);
        // Make extent writable
        fs.chmodSync(extentDest, 0o644);

        appendSysadmin(`Created database db-${dbNum} with stone "${stoneName}", version ${version}`);

        const db: GemStoneDatabase = {
          dirName: `db-${dbNum}`,
          path: dbDir,
          config: { version, stoneName, ldiName, baseExtent: `${baseExtent}.dbf` },
        };
        return db;
      },
    );
  }

  /** Delete a database directory after confirmation */
  async deleteDatabase(db: GemStoneDatabase): Promise<boolean> {
    // Check if processes are running
    if (this.processManager.isStoneRunning(db.config.stoneName)) {
      vscode.window.showErrorMessage(
        `Stone "${db.config.stoneName}" is still running. Stop it before deleting.`,
      );
      return false;
    }
    if (this.processManager.isNetldiRunning(db.config.ldiName)) {
      vscode.window.showErrorMessage(
        `NetLDI "${db.config.ldiName}" is still running. Stop it before deleting.`,
      );
      return false;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete database "${db.dirName}" (${db.config.stoneName})? This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return false;

    fs.rmSync(db.path, { recursive: true });
    appendSysadmin(`Deleted database ${db.dirName}`);
    return true;
  }

  /** Replace the extent and transaction logs with a fresh base extent */
  async replaceExtent(db: GemStoneDatabase): Promise<boolean> {
    if (this.processManager.isStoneRunning(db.config.stoneName)) {
      vscode.window.showErrorMessage(
        `Stone "${db.config.stoneName}" is still running. Stop it before replacing the extent.`,
      );
      return false;
    }

    const extents = this.storage.getAvailableExtents(db.config.version);
    if (extents.length === 0) {
      vscode.window.showErrorMessage(
        `No extent files found for version ${db.config.version}. Is it still extracted?`,
      );
      return false;
    }

    // Default selection to current base extent (without .dbf)
    const currentExtent = db.config.baseExtent.replace(/\.dbf$/, '');
    const extentPick = await vscode.window.showQuickPick(
      extents.map(e => ({ label: e, picked: e === currentExtent })),
      { placeHolder: 'Select new base extent', title: `Replace extent for ${db.config.stoneName}` },
    );
    if (!extentPick) return false;
    const newExtent = extentPick.label;

    const confirmed = await vscode.window.showWarningMessage(
      `Replace the database for "${db.config.stoneName}" with ${newExtent}? ` +
      `This will delete the current extent and all transaction logs. This cannot be undone.`,
      { modal: true },
      'Replace',
    );
    if (confirmed !== 'Replace') return false;

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Replacing extent for ${db.config.stoneName}...` },
      async (progress) => {
        const dataDir = path.join(db.path, 'data');

        // Delete all .dbf files in data/
        progress.report({ message: 'Removing old extent and transaction logs...' });
        for (const entry of fs.readdirSync(dataDir)) {
          if (entry.endsWith('.dbf')) {
            fs.unlinkSync(path.join(dataDir, entry));
          }
        }

        // Copy new extent
        progress.report({ message: 'Copying new extent (this may take a moment)...' });
        const gsPath = this.storage.getGemstonePath(db.config.version);
        if (!gsPath) {
          vscode.window.showErrorMessage(`GemStone ${db.config.version} not found.`);
          return false;
        }
        const extentSource = path.join(gsPath, 'bin', `${newExtent}.dbf`);
        const extentDest = path.join(dataDir, 'extent0.dbf');
        fs.copyFileSync(extentSource, extentDest);
        fs.chmodSync(extentDest, 0o644);

        // Update database.yaml
        progress.report({ message: 'Updating configuration...' });
        fs.writeFileSync(path.join(db.path, 'database.yaml'),
          `---\nbaseExtent: "${newExtent}.dbf"\nldiName: "${db.config.ldiName}"\n` +
          `stoneName: "${db.config.stoneName}"\nversion: "${db.config.version}"\n`);

        appendSysadmin(`Replaced extent for ${db.config.stoneName} with ${newExtent}.dbf`);
        return true;
      },
    );
  }
}
