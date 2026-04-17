import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';
import { SysadminStorage } from './sysadminStorage';
import { GemStoneVersion } from './sysadminTypes';
import { appendSysadmin, showSysadmin } from './sysadminChannel';
import { needsWsl, wslSpawn, wslExecSync } from './wslBridge';

const WIN_CLIENT_BASE_URL = 'https://downloads.gemtalksystems.com/pub/GemStone64/';

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

    // Add local (symlinked) versions first
    for (const ver of extractedVersions) {
      if (this.storage.isLocalVersion(ver)) {
        const gsPath = this.storage.getGemstonePath(ver);
        const info = gsPath ? SysadminStorage.readVersionTxt(gsPath) : undefined;
        versions.push({
          version: ver,
          fileName: '',
          url: '',
          size: 0,
          date: info?.date ?? '',
          downloaded: false,
          extracted: true,
          local: true,
          buildDescription: info?.description,
        });
      }
    }

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
        extracted: extractedVersions.has(version) && !this.storage.isLocalVersion(version),
      });
    }

    // Sort newest first; local versions before remote at same version
    versions.sort((a, b) => {
      const cmp = b.version.localeCompare(a.version, undefined, { numeric: true });
      if (cmp !== 0) return cmp;
      return (b.local ? 1 : 0) - (a.local ? 1 : 0);
    });
    return versions;
  }

  /** Download a version with progress reporting */
  async download(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.storage.ensureRootPath();
    const targetPath = needsWsl()
      ? `${this.storage.getWslRootPath()}/${version.fileName}`
      : path.join(this.storage.getRootPath(), version.fileName);

    if (needsWsl()) {
      // On Windows, download via curl inside WSL
      return new Promise<void>((resolve, reject) => {
        const proc = wslSpawn('curl', ['-L', '-o', targetPath, '-#', version.url]);

        token.onCancellationRequested(() => {
          proc.kill();
          try { wslExecSync(`rm -f "${targetPath}"`); } catch { /* ignore */ }
          reject(new Error('Download cancelled'));
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          const pctMatch = text.match(/([\d.]+)%/);
          if (pctMatch) {
            progress.report({ message: `${pctMatch[1]}%` });
          }
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            try { wslExecSync(`rm -f "${targetPath}"`); } catch { /* ignore */ }
            reject(new Error(`curl exited with code ${code}`));
          } else {
            resolve();
          }
        });
      });
    }

    return this.downloadFile(version.url, targetPath, progress, token);
  }

  /** Download a file via native Node.js HTTPS with redirect following */
  private downloadFile(
    url: string,
    targetPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const cleanup = () => {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    };

    const doDownload = (downloadUrl: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(targetPath);
        let cancelled = false;

        const cancel = token.onCancellationRequested(() => {
          cancelled = true;
          request.destroy();
          file.close(() => cleanup());
          cancel.dispose();
          reject(new Error('Download cancelled'));
        });

        const request = https.get(downloadUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close(() => {
              if (!cancelled) {
                doDownload(res.headers.location!).then(resolve, reject);
              }
            });
            return;
          }
          if (res.statusCode !== 200) {
            file.close(() => cleanup());
            reject(new Error(`HTTP ${res.statusCode} downloading ${downloadUrl}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] ?? '0', 10);
          let received = 0;

          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) {
              progress.report({ message: `${Math.round((received / total) * 100)}%` });
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            cancel.dispose();
            resolve();
          });

          file.on('error', (err) => {
            cleanup();
            cancel.dispose();
            reject(err);
          });
        });

        request.on('error', (err) => {
          file.close(() => cleanup());
          cancel.dispose();
          reject(err);
        });
      });
    };

    return doDownload(url);
  }

  /** Extract a downloaded version */
  async extract(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    if (process.platform === 'darwin') {
      const rootPath = this.storage.getRootPath();
      const filePath = path.join(rootPath, version.fileName);
      await this.extractDmg(filePath, rootPath, progress);
    } else {
      // Linux and Windows (via WSL) both use zip
      const rootPath = needsWsl()
        ? this.storage.getWslRootPath()
        : this.storage.getRootPath();
      const filePath = `${rootPath}/${version.fileName}`;
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
    if (needsWsl()) {
      wslExecSync(`unzip -o "${zipPath}" -d "${destDir}"`);
    } else {
      const result = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`unzip failed with exit code ${result.status}`);
      }
    }
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
      // Safety: if this is a symlink (local version), only remove the link
      if (this.storage.isLocalVersion(version.version)) {
        fs.unlinkSync(gsPath);
        appendSysadmin(`Unregistered local version: ${version.version}`);
        return;
      }
      if (needsWsl()) {
        const wslPath = this.storage.getWslGemstonePath(version.version);
        if (wslPath) {
          wslExecSync(`chmod -R u+w "${wslPath}" && rm -rf "${wslPath}"`);
        }
      } else {
        // Make writable first (GemStone sets some files read-only)
        execSync(`chmod -R u+w "${gsPath}"`);
        fs.rmSync(gsPath, { recursive: true });
      }
      appendSysadmin(`Deleted extracted version: ${path.basename(gsPath)}`);
    }
  }

  // ── Windows client distribution ────────────────────────────

  /** Fetch available Windows client versions from the downloads page */
  async fetchAvailableWindowsClientVersions(): Promise<GemStoneVersion[]> {
    const html = await this.fetchUrl(WIN_CLIENT_BASE_URL);

    // Parse version directories from the listing (e.g., href="3.7.5/")
    const versionRegex = /href="(\d+\.\d+(?:\.\d+)*)\/?"/g;
    const versionSet = new Set<string>();
    let match;
    while ((match = versionRegex.exec(html)) !== null) {
      versionSet.add(match[1]);
    }

    const downloaded = this.storage.getDownloadedWindowsClientFiles();
    const extractedVersions = new Set(this.storage.getExtractedWindowsClientVersions());

    const versions: GemStoneVersion[] = [];
    for (const version of versionSet) {
      const fileName = `GemStone64BitClient${version}-x86.Windows_NT.zip`;
      const url = `${WIN_CLIENT_BASE_URL}${version}/${fileName}`;
      versions.push({
        version,
        fileName,
        url,
        size: 0,
        date: '',
        downloaded: downloaded.has(version),
        extracted: extractedVersions.has(version),
      });
    }

    versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    return versions;
  }

  /** Download a Windows client version (always uses native HTTPS, not WSL) */
  async downloadWindowsClient(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.storage.ensureNativeRootPath();
    const targetPath = path.join(this.storage.getNativeRootPath(), version.fileName);
    return this.downloadFile(version.url, targetPath, progress, token);
  }

  /** Extract a downloaded Windows client zip using tar (built into Windows 10+) */
  async extractWindowsClient(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    const rootPath = this.storage.getNativeRootPath();
    const zipPath = path.join(rootPath, version.fileName);
    progress.report({ message: 'Extracting zip...' });
    execSync(`tar -xf "${zipPath}" -C "${rootPath}"`, { stdio: 'ignore' });
    appendSysadmin(`Extracted Windows client: ${version.fileName}`);
  }

  /** Delete a downloaded Windows client zip */
  async deleteWindowsClientDownload(version: GemStoneVersion): Promise<void> {
    const filePath = path.join(this.storage.getNativeRootPath(), version.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      appendSysadmin(`Deleted Windows client download: ${version.fileName}`);
    }
  }

  /** Delete an extracted Windows client directory */
  async deleteWindowsClientExtracted(version: GemStoneVersion): Promise<void> {
    const clientPath = this.storage.getWindowsClientPath(version.version);
    if (clientPath && fs.existsSync(clientPath)) {
      fs.rmSync(clientPath, { recursive: true });
      appendSysadmin(`Deleted Windows client: ${path.basename(clientPath)}`);
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
