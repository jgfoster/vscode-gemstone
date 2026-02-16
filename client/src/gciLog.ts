import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getGciLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GemStone');
  }
  return channel;
}

export function logQuery(sessionId: number, label: string, code: string): void {
  const log = getGciLog();
  log.appendLine(`[Session ${sessionId}] ${label}`);
  log.appendLine(code);
  log.appendLine('');
}

export function logResult(sessionId: number, result: string): void {
  const log = getGciLog();
  const preview = result.length > 500 ? result.substring(0, 500) + '...' : result;
  log.appendLine(`[Session ${sessionId}] → ${preview}`);
  log.appendLine('');
}

export function logError(sessionId: number, message: string): void {
  const log = getGciLog();
  log.appendLine(`[Session ${sessionId}] ERROR: ${message}`);
  log.appendLine('');
}

export function logGciCall(sessionId: number, func: string, args: Record<string, unknown>): void {
  const log = getGciLog();
  const formatted = Object.entries(args)
    .map(([k, v]) => {
      if (typeof v === 'bigint') return `${k}: 0x${v.toString(16)} (${v})`;
      if (typeof v === 'string' && v.length > 100) return `${k}: "${v.substring(0, 100)}..." (${v.length} chars)`;
      if (typeof v === 'string') return `${k}: "${v}"`;
      return `${k}: ${v}`;
    })
    .join(', ');
  log.appendLine(`[Session ${sessionId}] GCI: ${func}(${formatted})`);
}

export function logGciResult(sessionId: number, func: string, result: Record<string, unknown>): void {
  const log = getGciLog();
  const formatted = Object.entries(result)
    .map(([k, v]) => {
      if (typeof v === 'bigint') return `${k}: 0x${v.toString(16)} (${v})`;
      if (typeof v === 'string' && v.length > 200) return `${k}: "${v.substring(0, 200)}..." (${v.length} chars)`;
      if (typeof v === 'string') return `${k}: "${v}"`;
      if (typeof v === 'object' && v !== null) return `${k}: ${JSON.stringify(v)}`;
      return `${k}: ${v}`;
    })
    .join(', ');
  log.appendLine(`[Session ${sessionId}]   → ${formatted}`);
}

export function logInfo(message: string): void {
  const log = getGciLog();
  log.appendLine(message);
}
