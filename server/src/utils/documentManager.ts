import { Token, SourceRange, createPosition, createRange } from '../lexer/tokens';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import { ParseError } from '../parser/errors';
import { MethodNode } from '../parser/ast';
import { StatementNode } from '../parser/ast';
import { parseTopazDocument, TopazRegion, RegionKind, findRegionAtLine, toRegionPosition } from '../topaz/topazParser';
import { parseTonelDocument } from '../tonel/tonelParser';

export type DocumentFormat = 'topaz' | 'tonel' | 'smalltalk';

export interface ParsedRegion {
  region: TopazRegion;
  tokens: Token[];
  ast: MethodNode | null;
  /** For 'smalltalk-code' regions, the parsed statements (no method wrapper) */
  statements: StatementNode[] | null;
  errors: ParseError[];
}

export interface ParsedDocument {
  uri: string;
  version: number;
  text: string;
  /** The source format of this file */
  format: DocumentFormat;
  /** All tokens across all regions (with document-level positions) */
  tokens: Token[];
  /** All regions (Topaz or Tonel) */
  topazRegions: TopazRegion[];
  /** Parsed Smalltalk regions (code + method) */
  parsedRegions: ParsedRegion[];
  /** Aggregate errors from all regions */
  errors: ParseError[];
  /** Legacy: first method AST (for backward compatibility) */
  ast: MethodNode | null;
}

export class DocumentManager {
  private documents: Map<string, ParsedDocument> = new Map();

  update(uri: string, version: number, text: string, format: DocumentFormat = 'topaz'): ParsedDocument {
    const topazRegions = format === 'tonel'
      ? parseTonelDocument(text)
      : format === 'smalltalk'
        ? parseSmalltalkRegions(uri, text)
        : parseTopazDocument(text);
    const parsedRegions: ParsedRegion[] = [];
    const allErrors: ParseError[] = [];
    const allTokens: Token[] = [];
    let firstAst: MethodNode | null = null;

    for (const region of topazRegions) {
      if (region.kind === 'topaz' || region.kind === 'tonel-header') continue;

      const regionText = region.text;
      const lexer = new Lexer(regionText);
      const regionTokens = lexer.tokenize();

      // Offset token positions to document-level coordinates
      const offsetTokens = regionTokens.map((t) => offsetToken(t, region.startLine));
      allTokens.push(...offsetTokens);

      if (region.kind === 'smalltalk-method') {
        const parser = new Parser(regionTokens);
        const { ast, errors } = parser.parse();

        // Offset error positions to document level
        const offsetErrors = errors.map((e) => offsetError(e, region.startLine));
        allErrors.push(...offsetErrors);

        if (ast && !firstAst) firstAst = ast;

        parsedRegions.push({
          region,
          tokens: offsetTokens,
          ast,
          statements: null,
          errors: offsetErrors,
        });
      } else {
        // smalltalk-code: parse as statements (wrap in a dummy method for reuse)
        // We parse as if it were a method body by prepending a dummy selector
        const wrappedText = '_doIt\n' + regionText;
        const wrappedLexer = new Lexer(wrappedText);
        const wrappedTokens = wrappedLexer.tokenize();
        const parser = new Parser(wrappedTokens);
        const { ast, errors } = parser.parse();

        // Offset errors: subtract 1 line for the dummy selector, then add region offset
        const offsetErrors = errors.map((e) => ({
          ...e,
          range: offsetRange(e.range, region.startLine - 1),
        }));
        allErrors.push(...offsetErrors);

        parsedRegions.push({
          region,
          tokens: offsetTokens,
          ast,
          statements: ast?.body.statements ?? null,
          errors: offsetErrors,
        });
      }
    }

    const doc: ParsedDocument = {
      uri,
      version,
      text,
      format,
      tokens: allTokens,
      topazRegions,
      parsedRegions,
      errors: allErrors,
      ast: firstAst,
    };

    this.documents.set(uri, doc);
    return doc;
  }

  get(uri: string): ParsedDocument | undefined {
    return this.documents.get(uri);
  }

  remove(uri: string): void {
    this.documents.delete(uri);
  }

  /**
   * Find the parsed region containing a document-level line.
   */
  findRegionAt(doc: ParsedDocument, line: number): ParsedRegion | undefined {
    return doc.parsedRegions.find(
      (pr) => line >= pr.region.startLine && line <= pr.region.endLine
    );
  }
}

function offsetToken(token: Token, lineOffset: number): Token {
  return {
    ...token,
    range: offsetRange(token.range, lineOffset),
  };
}

function offsetError(error: ParseError, lineOffset: number): ParseError {
  return {
    ...error,
    range: offsetRange(error.range, lineOffset),
  };
}

function offsetRange(range: SourceRange, lineOffset: number): SourceRange {
  return createRange(
    createPosition(range.start.offset, range.start.line + lineOffset, range.start.column),
    createPosition(range.end.offset, range.end.line + lineOffset, range.end.column),
  );
}

/**
 * Create a single region for a raw Smalltalk document (gemstone:// URI).
 * Determines method vs code based on the URI path structure.
 */
function parseSmalltalkRegions(uri: string, text: string): TopazRegion[] {
  const lines = text.split('\n');
  const endLine = Math.max(0, lines.length - 1);

  let kind: RegionKind = 'smalltalk-method';
  let className: string | undefined;
  let command: string | undefined;

  try {
    const url = new URL(uri);
    const parts = url.pathname.split('/').map(decodeURIComponent);
    // parts[0] = '' (leading slash)
    // Method: /dict/class/side/category/selector (6 parts)
    // Definition: /dict/class/definition (4 parts)
    if (parts.length === 6) {
      kind = 'smalltalk-method';
      className = parts[2];
      command = parts[3] === 'class' ? 'classmethod' : 'method';
    } else {
      kind = 'smalltalk-code';
      if (parts.length >= 3) className = parts[2];
    }
  } catch {
    // If URI parsing fails, default to method
  }

  return [{
    kind,
    startLine: 0,
    endLine,
    text,
    className,
    command,
  }];
}
