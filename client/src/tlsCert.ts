import * as fs from 'fs';
import * as path from 'path';
import { generate as generateCert } from 'selfsigned';

export interface TlsMaterial {
  cert: Buffer;
  key: Buffer;
  /** Absolute path to the cert PEM on disk — suitable for user trust commands. */
  certPath: string;
  /** Absolute path to the key PEM on disk. */
  keyPath: string;
  /** True if a new cert was just generated (useful for first-run UX). */
  generated: boolean;
}

const CERT_FILE = 'mcp-tls-cert.pem';
const KEY_FILE = 'mcp-tls-key.pem';

/**
 * Load a cert/key pair from `storageDir`, generating a self-signed one valid
 * for 127.0.0.1 + localhost on first run. Claude Desktop's "Add custom
 * connector" dialog rejects plain-http URLs, so this is required to expose
 * the gemstone MCP surface via that UI; the user has to trust the cert once
 * in their OS keychain.
 */
export async function ensureSelfSignedCert(storageDir: string): Promise<TlsMaterial> {
  const certPath = path.join(storageDir, CERT_FILE);
  const keyPath = path.join(storageDir, KEY_FILE);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      certPath,
      keyPath,
      generated: false,
    };
  }

  fs.mkdirSync(storageDir, { recursive: true });

  const now = new Date();
  const tenYearsFromNow = new Date(now);
  tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
  const pem = await generateCert(
    [{ name: 'commonName', value: '127.0.0.1' }],
    {
      notBeforeDate: now,
      notAfterDate: tenYearsFromNow,
      keySize: 2048,
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 7, ip: '127.0.0.1' },
            { type: 2, value: 'localhost' },
          ],
        },
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
      ],
    },
  );

  fs.writeFileSync(certPath, pem.cert, { mode: 0o600 });
  fs.writeFileSync(keyPath, pem.private, { mode: 0o600 });

  return {
    cert: Buffer.from(pem.cert),
    key: Buffer.from(pem.private),
    certPath,
    keyPath,
    generated: true,
  };
}

/** Load a cert/key pair from explicit paths (user override). */
export function loadUserCert(certPath: string, keyPath: string): TlsMaterial {
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    certPath,
    keyPath,
    generated: false,
  };
}

/**
 * Platform-specific command the user can run to install the cert into the
 * system trust store. Presented verbatim so they can copy-paste or we can
 * offer it as a spawned command with confirmation.
 */
export function trustCertCommand(certPath: string): string {
  if (process.platform === 'darwin') {
    // -d: add to admin (system) domain; -r trustRoot: treat as root CA;
    // -p ssl: trust for SSL only; will prompt for admin password.
    return `sudo security add-trusted-cert -d -r trustRoot -p ssl -k /Library/Keychains/System.keychain "${certPath}"`;
  }
  if (process.platform === 'win32') {
    // User-scope root store — no admin prompt required.
    return `certutil -user -addstore Root "${certPath}"`;
  }
  // Linux: NSS db (Chromium/Electron). Not all distros have certutil installed
  // by default (apt: libnss3-tools; dnf: nss-tools), so we surface that here.
  return `mkdir -p "$HOME/.pki/nssdb" && certutil -d sql:"$HOME/.pki/nssdb" -A -t C,, -n "Jasper MCP" -i "${certPath}"`;
}
