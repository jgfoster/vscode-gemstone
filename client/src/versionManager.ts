import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn, execSync } from 'child_process';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneVersion } from './sysadminTypes';
import { appendSysadmin, showSysadmin } from './sysadminChannel';

export class VersionManager {
  constructor(private storage: SysadminStorage) {}

  /** Fetch available versions from the downloads page */
  async fetchAvailableVersions(): Promise<GemStoneVersion[]> {
    const platformKey = this.storage.getPlatformKey();
    if (!platformKey) {
      throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
    }
    const ext = this.storage.getDownloadExtension();
    const url = `https://downloads.gemtalksystems.com/platforms/${platformKey}/`;
    const html = await this.fetchUrl(url);

    const versions: GemStoneVersion[] = [];
    const regex = new RegExp(
      `href="(GemStone64Bit([\\d.]+)-${platformKey.replace('.', '\\.')}\\.${ext})"[^>]*>.*?` +
      `(\\d{2}-\\w{3}-\\d{4})\\s+\\d{2}:\\d{2}\\s+(\\d+)`,
      'g',
    );

    const downloaded = this.storage.getDownloadedFiles();
    const extractedVersions = new Set(this.storage.getExtractedVersions());

    let match;
    while ((match = regex.exec(html)) !== null) {
      const fileName = match[1];
      const version = match[2];
      const date = match[3];
      const size = parseInt(match[4], 10);
      const isDownloaded = downloaded.has(version) && downloaded.get(version) === size;
      versions.push({
        version,
        fileName,
        url: `${url}${fileName}`,
        size,
        date,
        downloaded: isDownloaded,
        extracted: extractedVersions.has(version),
      });
    }

    // Sort newest first
    versions.reverse();
    return versions;
  }

  /** Download a version with progress reporting */
  async download(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.storage.ensureRootPath();
    const targetPath = path.join(this.storage.getRootPath(), version.fileName);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn('curl', ['-L', '-o', targetPath, '-#', version.url]);

      token.onCancellationRequested(() => {
        proc.kill();
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        reject(new Error('Download cancelled'));
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        const pctMatch = text.match(/([\d.]+)%/);
        if (pctMatch) {
          progress.report({ message: `${pctMatch[1]}%` });
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          reject(new Error(`curl exited with code ${code}`));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /** Extract a downloaded version */
  async extract(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    const rootPath = this.storage.getRootPath();
    const filePath = path.join(rootPath, version.fileName);

    if (process.platform === 'darwin') {
      await this.extractDmg(filePath, rootPath, progress);
    } else {
      await this.extractZip(filePath, rootPath, progress);
    }
  }

  private async extractDmg(
    dmgPath: string,
    destDir: string,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    progress.report({ message: 'Mounting DMG...' });
    const attachOutput = execSync(`hdiutil attach -nobrowse "${dmgPath}"`, { encoding: 'utf-8' });
    // Parse mount point from last line: /dev/diskXsY  Apple_HFS  /Volumes/GemStone64Bit...
    const lines = attachOutput.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const mountMatch = lastLine.match(/\t(\/Volumes\/.+)$/);
    if (!mountMatch) {
      throw new Error(`Failed to parse mount point from: ${lastLine}`);
    }
    const mountPoint = mountMatch[1];

    try {
      progress.report({ message: 'Copying files...' });
      // Find the GemStone directory in the mount point
      const entries = fs.readdirSync(mountPoint);
      const gsDir = entries.find(e => e.startsWith('GemStone64Bit'));
      if (!gsDir) {
        throw new Error(`No GemStone directory found in mounted DMG at ${mountPoint}`);
      }
      const srcPath = path.join(mountPoint, gsDir);
      const destPath = path.join(destDir, gsDir);
      execSync(`cp -R "${srcPath}" "${destPath}"`);
      appendSysadmin(`Extracted ${gsDir} to ${destDir}`);
    } finally {
      progress.report({ message: 'Unmounting DMG...' });
      try {
        execSync(`hdiutil detach "${mountPoint}"`);
      } catch {
        // Best effort unmount
      }
    }
  }

  private async extractZip(
    zipPath: string,
    destDir: string,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    progress.report({ message: 'Extracting zip...' });
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`);
    appendSysadmin(`Extracted ${path.basename(zipPath)} to ${destDir}`);
  }

  /** Delete a downloaded file */
  async deleteDownload(version: GemStoneVersion): Promise<void> {
    const filePath = path.join(this.storage.getRootPath(), version.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      appendSysadmin(`Deleted download: ${version.fileName}`);
    }
  }

  /** Delete an extracted version directory */
  async deleteExtracted(version: GemStoneVersion): Promise<void> {
    const gsPath = this.storage.getGemstonePath(version.version);
    if (gsPath && fs.existsSync(gsPath)) {
      // Make writable first (GemStone sets some files read-only)
      execSync(`chmod -R u+w "${gsPath}"`);
      fs.rmSync(gsPath, { recursive: true });
      appendSysadmin(`Deleted extracted version: ${path.basename(gsPath)}`);
    }
  }

  private fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { timeout: 10000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetchUrl(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error(`Timeout fetching ${url}`));
      });
    });
  }
}
