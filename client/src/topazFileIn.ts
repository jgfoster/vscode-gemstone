/**
 * Parses a Topaz file-out and compiles each piece back into GemStone.
 *
 * Copied from server/src/topaz/topazParser.ts (parseTopazDocument only)
 * because the server and client have separate tsconfig roots and
 * cannot share imports without build configuration changes.
 */
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';

// ── Topaz Parser (copied from server) ──────────────────────────

type RegionKind = 'topaz' | 'smalltalk-code' | 'smalltalk-method' | 'tonel-header';

interface TopazRegion {
  kind: RegionKind;
  startLine: number;
  endLine: number;
  text: string;
  className?: string;
  command?: string;
}

const CODE_COMMANDS = ['run', 'doit', 'print', 'printit'];
const METHOD_COMMANDS = ['method', 'classmethod'];

function matchCommand(line: string, commands: string[]): { command: string; rest: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const match = trimmed.match(/^([a-zA-Z]+)(:?\s*)(.*)/);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const sep = match[2];
  const rest = match[3];

  for (const cmd of commands) {
    if (cmd.startsWith(word) && word.length >= minAbbrev(cmd)) {
      return { command: cmd, rest: (sep + rest).trim() };
    }
  }

  return null;
}

function minAbbrev(cmd: string): number {
  switch (cmd) {
    case 'run': return 3;
    case 'doit': return 2;
    case 'print': return 2;
    case 'printit': return 7;
    case 'method': return 3;
    case 'classmethod': return 6;
    default: return 3;
  }
}

export function parseTopazDocument(text: string): TopazRegion[] {
  const lines = text.split('\n');
  const regions: TopazRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const codeMatch = matchCommand(line, CODE_COMMANDS);
    if (codeMatch) {
      i++;
      const startLine = i;
      const codeLines: string[] = [];

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

      if (i < lines.length && lines[i].trim() === '%') {
        i++;
      }
      continue;
    }

    const methodMatch = matchCommand(line, METHOD_COMMANDS);
    if (methodMatch) {
      let className: string | undefined;
      const restTrimmed = methodMatch.rest.replace(/^:\s*/, '').trim();
      if (restTrimmed.length > 0) {
        className = restTrimmed;
      }

      i++;
      const startLine = i;
      const methodLines: string[] = [];

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

      if (i < lines.length && lines[i].trim() === '%') {
        i++;
      }
      continue;
    }

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

// ── File-In Logic ──────────────────────────────────────────────

export interface FileInError {
  message: string;
  /** 0-based line in the .gs file */
  line: number;
  className?: string;
  selector?: string;
}

export interface FileInResult {
  success: boolean;
  errors: FileInError[];
  compiledMethods: number;
  compiledClassDef: boolean;
  deletedMethods: number;
}

/**
 * Parse a Topaz file-out and compile each piece (class definition + methods)
 * back into GemStone. Returns per-method error details for diagnostics.
 */
export function fileInClass(
  session: ActiveSession,
  fileContent: string,
  environmentId: number = 0,
): FileInResult {
  const regions = parseTopazDocument(fileContent);
  const errors: FileInError[] = [];
  let compiledMethods = 0;
  let compiledClassDef = false;
  let currentCategory = 'as yet unclassified';

  for (const region of regions) {
    if (region.kind === 'topaz') {
      // Scan for category: 'Name' commands
      for (const line of region.text.split('\n')) {
        const catMatch = line.match(/^category:\s*'([^']*)'/i);
        if (catMatch) {
          currentCategory = catMatch[1];
        }
      }
      continue;
    }

    if (region.kind === 'smalltalk-code') {
      // Check if this is a class definition (contains subclass:)
      if (region.text.includes('subclass:')) {
        try {
          queries.compileClassDefinition(session, region.text);
          compiledClassDef = true;
        } catch (e: unknown) {
          const msg = e instanceof BrowserQueryError ? e.message : String(e);
          errors.push({
            message: msg,
            line: region.startLine,
          });
        }
      }
      continue;
    }

    if (region.kind === 'smalltalk-method') {
      const className = region.className;
      if (!className) {
        errors.push({
          message: 'Method region missing class name',
          line: region.startLine,
        });
        continue;
      }

      const isMeta = region.command === 'classmethod';
      const selector = region.text.split('\n')[0]?.trim();

      try {
        queries.compileMethod(
          session, className, isMeta, currentCategory, region.text, environmentId,
        );
        compiledMethods++;
      } catch (e: unknown) {
        const msg = e instanceof BrowserQueryError ? e.message : String(e);
        errors.push({
          message: msg,
          line: region.startLine,
          className,
          selector,
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
    compiledMethods,
    compiledClassDef,
    deletedMethods: 0,
  };
}

// ── Differential File-In ──────────────────────────────────

interface MethodKey {
  className: string;
  isMeta: boolean;
  selector: string;
}

interface ParsedMethod {
  key: MethodKey;
  text: string;
  category: string;
  region: TopazRegion;
}

export interface ParsedFile {
  classDef?: { text: string; region: TopazRegion };
  methods: ParsedMethod[];
}

function methodKeyString(key: MethodKey): string {
  return `${key.className}${key.isMeta ? ' class' : ''}>>${key.selector}`;
}

/**
 * Parse a Topaz file-out into structured class definition and methods,
 * tracking the effective category for each method.
 */
export function parseFileStructure(content: string): ParsedFile {
  const regions = parseTopazDocument(content);
  const methods: ParsedMethod[] = [];
  let classDef: ParsedFile['classDef'];
  let currentCategory = 'as yet unclassified';

  for (const region of regions) {
    if (region.kind === 'topaz') {
      for (const line of region.text.split('\n')) {
        const catMatch = line.match(/^category:\s*'([^']*)'/i);
        if (catMatch) currentCategory = catMatch[1];
      }
      continue;
    }

    if (region.kind === 'smalltalk-code' && region.text.includes('subclass:')) {
      classDef = { text: region.text, region };
      continue;
    }

    if (region.kind === 'smalltalk-method' && region.className) {
      const isMeta = region.command === 'classmethod';
      const selector = region.text.split('\n')[0]?.trim() || '';
      methods.push({
        key: { className: region.className, isMeta, selector },
        text: region.text,
        category: currentCategory,
        region,
      });
    }
  }

  return { classDef, methods };
}

/**
 * Parse old and new file content, compile only changed/new regions,
 * and delete methods that were removed. Falls back to full `fileInClass`
 * when no old content is available.
 */
export function fileInChangedRegions(
  session: ActiveSession,
  oldContent: string | undefined,
  newContent: string,
  environmentId: number = 0,
): FileInResult {
  if (oldContent === undefined) {
    return fileInClass(session, newContent, environmentId);
  }

  const oldFile = parseFileStructure(oldContent);
  const newFile = parseFileStructure(newContent);

  const errors: FileInError[] = [];
  let compiledMethods = 0;
  let compiledClassDef = false;
  let deletedMethods = 0;

  // Compile class definition if changed
  if (newFile.classDef) {
    if (oldFile.classDef?.text !== newFile.classDef.text) {
      try {
        queries.compileClassDefinition(session, newFile.classDef.text);
        compiledClassDef = true;
      } catch (e: unknown) {
        const msg = e instanceof BrowserQueryError ? e.message : String(e);
        errors.push({ message: msg, line: newFile.classDef.region.startLine });
      }
    }
  }

  // Build map of old methods
  const oldMethodMap = new Map<string, ParsedMethod>();
  for (const m of oldFile.methods) {
    oldMethodMap.set(methodKeyString(m.key), m);
  }

  // Compile changed or new methods
  const newMethodKeys = new Set<string>();
  for (const m of newFile.methods) {
    const keyStr = methodKeyString(m.key);
    newMethodKeys.add(keyStr);
    const oldMethod = oldMethodMap.get(keyStr);

    if (!oldMethod || oldMethod.text !== m.text || oldMethod.category !== m.category) {
      try {
        queries.compileMethod(
          session, m.key.className, m.key.isMeta, m.category, m.text, environmentId,
        );
        compiledMethods++;
      } catch (e: unknown) {
        const msg = e instanceof BrowserQueryError ? e.message : String(e);
        errors.push({
          message: msg,
          line: m.region.startLine,
          className: m.key.className,
          selector: m.key.selector,
        });
      }
    }
  }

  // Delete methods removed from file (only if no compilation errors)
  if (errors.length === 0) {
    for (const [keyStr, oldMethod] of oldMethodMap) {
      if (!newMethodKeys.has(keyStr)) {
        try {
          queries.deleteMethod(
            session, oldMethod.key.className, oldMethod.key.isMeta, oldMethod.key.selector,
          );
          deletedMethods++;
        } catch (e: unknown) {
          const msg = e instanceof BrowserQueryError ? e.message : String(e);
          errors.push({
            message: msg,
            line: 0,
            className: oldMethod.key.className,
            selector: oldMethod.key.selector,
          });
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
    compiledMethods,
    compiledClassDef,
    deletedMethods,
  };
}
