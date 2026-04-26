import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureSelfSignedCert, loadUserCert, trustCertCommand } from '../tlsCert';

function mkStorage(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-tls-test-'));
}

function cleanup(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function withPlatform(platform: string, fn: () => void) {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  }
}

describe('ensureSelfSignedCert', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) cleanup(dirs.pop()!);
  });

  it('generates a cert + key on first run with `generated: true`', async () => {
    const dir = mkStorage(); dirs.push(dir);
    const material = await ensureSelfSignedCert(dir);
    expect(material.generated).toBe(true);
    expect(material.cert.toString()).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(material.key.toString()).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/);
    expect(fs.existsSync(material.certPath)).toBe(true);
    expect(fs.existsSync(material.keyPath)).toBe(true);
  });

  it('reuses existing cert on second run with `generated: false`', async () => {
    const dir = mkStorage(); dirs.push(dir);
    const first = await ensureSelfSignedCert(dir);
    const second = await ensureSelfSignedCert(dir);
    expect(second.generated).toBe(false);
    expect(second.cert.toString()).toBe(first.cert.toString());
    expect(second.key.toString()).toBe(first.key.toString());
  });

  it('creates the storage directory if missing', async () => {
    const parent = mkStorage(); dirs.push(parent);
    const nested = path.join(parent, 'nested', 'mcp');
    expect(fs.existsSync(nested)).toBe(false);
    const material = await ensureSelfSignedCert(nested);
    expect(fs.existsSync(material.certPath)).toBe(true);
  });

  it('writes cert + key with 0600 permissions', async () => {
    if (process.platform === 'win32') return; // POSIX only
    const dir = mkStorage(); dirs.push(dir);
    const material = await ensureSelfSignedCert(dir);
    const certMode = fs.statSync(material.certPath).mode & 0o777;
    const keyMode = fs.statSync(material.keyPath).mode & 0o777;
    expect(certMode).toBe(0o600);
    expect(keyMode).toBe(0o600);
  });
});

describe('loadUserCert', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) cleanup(dirs.pop()!);
  });

  it('loads cert + key bytes from the given paths', async () => {
    const dir = mkStorage(); dirs.push(dir);
    const material = await ensureSelfSignedCert(dir);
    const loaded = loadUserCert(material.certPath, material.keyPath);
    expect(loaded.cert.toString()).toBe(material.cert.toString());
    expect(loaded.key.toString()).toBe(material.key.toString());
    expect(loaded.generated).toBe(false);
  });
});

describe('trustCertCommand', () => {
  it('uses security add-trusted-cert on macOS', () => {
    withPlatform('darwin', () => {
      const cmd = trustCertCommand('/tmp/cert.pem');
      expect(cmd).toContain('security add-trusted-cert');
      expect(cmd).toContain('/tmp/cert.pem');
      expect(cmd).toContain('-r trustRoot');
    });
  });

  it('uses certutil -user -addstore on Windows', () => {
    withPlatform('win32', () => {
      const cmd = trustCertCommand('C:\\path\\cert.pem');
      expect(cmd).toContain('certutil');
      expect(cmd).toContain('-user');
      expect(cmd).toContain('-addstore Root');
      expect(cmd).toContain('cert.pem');
    });
  });

  it('uses NSS db certutil on Linux', () => {
    withPlatform('linux', () => {
      const cmd = trustCertCommand('/tmp/cert.pem');
      expect(cmd).toContain('.pki/nssdb');
      expect(cmd).toContain('/tmp/cert.pem');
      expect(cmd).toContain('Jasper MCP');
    });
  });
});
