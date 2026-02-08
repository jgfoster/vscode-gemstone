import { Token, SourceRange, createPosition, createRange } from '../lexer/tokens';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import { ParseError } from '../parser/errors';
import { MethodNode } from '../parser/ast';
import { StatementNode } from '../parser/ast';
import { parseTopazDocument, TopazRegion, findRegionAtLine, toRegionPosition } from '../topaz/topazParser';

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
  /** All tokens across all regions (with document-level positions) */
  tokens: Token[];
  /** All Topaz regions */
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

  update(uri: string, version: number, text: string): ParsedDocument {
    const topazRegions = parseTopazDocument(text);
    const parsedRegions: ParsedRegion[] = [];
    const allErrors: ParseError[] = [];
    const allTokens: Token[] = [];
    let firstAst: MethodNode | null = null;

    for (const region of topazRegions) {
      if (region.kind === 'topaz') continue;

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
