/**
 * Parses a Topaz script into a sequence of regions.
 *
 * A Topaz file consists of:
 *   - Topaz command lines (most lines)
 *   - Smalltalk code blocks: started by `run`, `doit`, or `print`, ended by `%`
 *   - Smalltalk method definitions: started by `method:` or `classmethod:`, ended by `%`
 *
 * Topaz commands can be abbreviated (e.g., `method` for `method:`, `run` for `run`).
 */

export type RegionKind = 'topaz' | 'smalltalk-code' | 'smalltalk-method' | 'tonel-header';

export interface TopazRegion {
  kind: RegionKind;
  /** 0-based start line (inclusive) */
  startLine: number;
  /** 0-based end line (inclusive) */
  endLine: number;
  /** The text content of this region (excluding the command line and %) */
  text: string;
  /** For method regions: the class name if specified */
  className?: string;
  /** The Topaz command that started this region (for code/method regions) */
  command?: string;
  /** For Tonel methods: line of the { #category } annotation */
  annotationStartLine?: number;
  /** For Tonel methods: line of the closing ] bracket */
  closingBracketLine?: number;
}

/** Known Topaz commands that do NOT start Smalltalk blocks */
const TOPAZ_COMMANDS = [
  'abort', 'begin', 'category', 'classmethod', 'commit', 'display',
  'doit', 'edit', 'errorcount', 'exec', 'exit', 'expecterror',
  'expectvalue', 'fileout', 'filein', 'iferr', 'iferror', 'input',
  'level', 'limit', 'list', 'login', 'logout', 'lookup',
  'method', 'obj', 'object', 'omit', 'output', 'pausealiasing',
  'print', 'printit', 'protect', 'quit', 'releaseall', 'removeallclassmethods', 'removeallmethods',
  'run', 'send', 'set', 'shell', 'spawn', 'stack', 'stk',
  'time', 'topaz', 'where',
];

/** Commands that start a Smalltalk expression block (code) */
const CODE_COMMANDS = ['run', 'doit', 'print', 'printit'];

/** Commands that start a Smalltalk method definition */
const METHOD_COMMANDS = ['method', 'classmethod'];

/**
 * Check if a line starts with a given command (case-insensitive).
 * Topaz allows abbreviation, so we check if the command starts with
 * enough characters to be unambiguous. For our key commands (run, doit,
 * print, method, classmethod) we accept any prefix that uniquely
 * identifies them among TOPAZ_COMMANDS.
 */
function matchCommand(line: string, commands: string[]): { command: string; rest: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  // Split on first whitespace or colon
  const match = trimmed.match(/^([a-zA-Z]+)(:?\s*)(.*)/);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const sep = match[2];
  const rest = match[3];

  for (const cmd of commands) {
    // The word must be a prefix of the command (abbreviation) or an exact match
    if (cmd.startsWith(word) && word.length >= minAbbrev(cmd)) {
      return { command: cmd, rest: (sep + rest).trim() };
    }
  }

  return null;
}

/**
 * Minimum abbreviation length for unambiguous command matching.
 * For our key commands, we use practical minimums:
 */
function minAbbrev(cmd: string): number {
  switch (cmd) {
    case 'run': return 3;
    case 'doit': return 2;
    case 'print': return 2;
    case 'printit': return 7; // distinguish from 'print' and 'protect'
    case 'method': return 3; // distinguish from 'me' being ambiguous
    case 'classmethod': return 6; // 'classm' is enough
    default: return 3;
  }
}

export function parseTopazDocument(text: string): TopazRegion[] {
  const lines = text.split('\n');
  const regions: TopazRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for code-starting commands: run, doit, print
    const codeMatch = matchCommand(line, CODE_COMMANDS);
    if (codeMatch) {
      const commandLine = i;
      i++;
      const startLine = i;
      const codeLines: string[] = [];

      // Collect lines until % on its own line
      while (i < lines.length && lines[i].trim() !== '%') {
        codeLines.push(lines[i]);
        i++;
      }

      const endLine = i > startLine ? i - 1 : startLine;

      regions.push({
        kind: 'smalltalk-code',
        startLine,
        endLine,
        text: codeLines.join('\n'),
        command: codeMatch.command,
      });

      // Skip the % line
      if (i < lines.length && lines[i].trim() === '%') {
        i++;
      }
      continue;
    }

    // Check for method-starting commands: method, classmethod
    const methodMatch = matchCommand(line, METHOD_COMMANDS);
    if (methodMatch) {
      const commandLine = i;
      // Extract class name if present: "method: ClassName" or "method ClassName"
      let className: string | undefined;
      const restTrimmed = methodMatch.rest.replace(/^:\s*/, '').trim();
      if (restTrimmed.length > 0) {
        className = restTrimmed;
      }

      i++;
      const startLine = i;
      const methodLines: string[] = [];

      // Collect lines until % on its own line
      while (i < lines.length && lines[i].trim() !== '%') {
        methodLines.push(lines[i]);
        i++;
      }

      const endLine = i > startLine ? i - 1 : startLine;

      regions.push({
        kind: 'smalltalk-method',
        startLine,
        endLine,
        text: methodLines.join('\n'),
        command: methodMatch.command,
        className,
      });

      // Skip the % line
      if (i < lines.length && lines[i].trim() === '%') {
        i++;
      }
      continue;
    }

    // Regular Topaz command line - accumulate consecutive command lines
    const topazStart = i;
    while (i < lines.length) {
      const nextCode = matchCommand(lines[i], CODE_COMMANDS);
      const nextMethod = matchCommand(lines[i], METHOD_COMMANDS);
      if (nextCode || nextMethod) break;
      i++;
    }

    regions.push({
      kind: 'topaz',
      startLine: topazStart,
      endLine: i - 1,
      text: lines.slice(topazStart, i).join('\n'),
    });
  }

  return regions;
}

/**
 * Find the region containing a given line number.
 */
export function findRegionAtLine(regions: TopazRegion[], line: number): TopazRegion | undefined {
  return regions.find((r) => line >= r.startLine && line <= r.endLine);
}

/**
 * Convert a document-level line/column to a region-relative line/column.
 */
export function toRegionPosition(region: TopazRegion, line: number, character: number): { line: number; character: number } {
  return {
    line: line - region.startLine,
    character,
  };
}

/**
 * Convert a region-relative line/column back to document-level.
 */
export function toDocumentPosition(region: TopazRegion, line: number, character: number): { line: number; character: number } {
  return {
    line: line + region.startLine,
    character,
  };
}
