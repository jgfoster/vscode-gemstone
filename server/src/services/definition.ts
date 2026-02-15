import { Location, Position } from 'vscode-languageserver';
import { ParsedDocument, ParsedRegion } from '../utils/documentManager';
import { ScopeAnalyzer } from '../utils/scopeAnalyzer';
import { TokenType, SourceRange, createPosition } from '../lexer/tokens';
import { findTokenAt, findKeywordSelector, isVariableInAST } from '../utils/astUtils';
import { WorkspaceIndex } from '../utils/workspaceIndex';

export function getDefinition(doc: ParsedDocument, position: Position, region?: ParsedRegion): Location | null {
  const ast = region?.ast ?? doc.ast;
  if (!ast) return null;

  const tokens = region?.tokens ?? doc.tokens;
  const token = findTokenAt(tokens, position);
  if (!token) return null;

  // For identifiers, try local variable definition first
  if (token.type === TokenType.Identifier) {
    const analyzer = new ScopeAnalyzer();
    const root = analyzer.analyze(ast);
    const pos = createPosition(0, position.line, position.character);
    const varInfo = analyzer.findVariableAt(root, token.text, pos);

    if (varInfo) {
      return {
        uri: doc.uri,
        range: {
          start: {
            line: varInfo.definitionRange.start.line,
            character: varInfo.definitionRange.start.column,
          },
          end: {
            line: varInfo.definitionRange.end.line,
            character: varInfo.definitionRange.end.column,
          },
        },
      };
    }
  }

  return null;
}

/** Cross-file definition: find implementors of the selector at the cursor. */
export function getWorkspaceDefinition(
  doc: ParsedDocument,
  position: Position,
  region: ParsedRegion | undefined,
  index: WorkspaceIndex,
): Location[] | null {
  const ast = region?.ast ?? doc.ast;
  if (!ast) return null;

  const tokens = region?.tokens ?? doc.tokens;
  const token = findTokenAt(tokens, position);
  if (!token) return null;

  const lineOffset = region
    ? region.region.startLine - (region.region.kind === 'smalltalk-code' ? 1 : 0)
    : 0;

  let selector: string | null = null;

  // Identifier that isn't a variable in the AST → unary selector
  if (token.type === TokenType.Identifier) {
    const astRange: SourceRange = {
      start: { ...token.range.start, line: token.range.start.line - lineOffset },
      end: { ...token.range.end, line: token.range.end.line - lineOffset },
    };
    if (!isVariableInAST(ast, astRange)) {
      selector = token.text;
    }
  }

  // Keyword → compose full selector from AST
  if (token.type === TokenType.Keyword) {
    const astRange: SourceRange = {
      start: { ...token.range.start, line: token.range.start.line - lineOffset },
      end: { ...token.range.end, line: token.range.end.line - lineOffset },
    };
    selector = findKeywordSelector(ast, astRange);
  }

  // Binary selector
  if (
    token.type === TokenType.BinarySelector ||
    token.type === TokenType.Minus ||
    token.type === TokenType.LessThan ||
    token.type === TokenType.GreaterThan
  ) {
    selector = token.text;
  }

  if (!selector) return null;

  const implementors = index.findImplementors(selector);
  if (implementors.length === 0) return null;

  return implementors.map(m => ({
    uri: m.uri,
    range: {
      start: { line: m.startLine, character: 0 },
      end: { line: m.endLine, character: 0 },
    },
  }));
}

/** Cross-file references: find senders of the selector at the cursor. */
export function getWorkspaceReferences(
  doc: ParsedDocument,
  position: Position,
  region: ParsedRegion | undefined,
  index: WorkspaceIndex,
): Location[] | null {
  const ast = region?.ast ?? doc.ast;
  if (!ast) return null;

  const tokens = region?.tokens ?? doc.tokens;
  const token = findTokenAt(tokens, position);
  if (!token) return null;

  const lineOffset = region
    ? region.region.startLine - (region.region.kind === 'smalltalk-code' ? 1 : 0)
    : 0;

  let selector: string | null = null;

  // Identifier: could be a unary selector (message) or a method pattern name
  if (token.type === TokenType.Identifier) {
    const astRange: SourceRange = {
      start: { ...token.range.start, line: token.range.start.line - lineOffset },
      end: { ...token.range.end, line: token.range.end.line - lineOffset },
    };
    if (!isVariableInAST(ast, astRange)) {
      selector = token.text;
    }
  }

  if (token.type === TokenType.Keyword) {
    const astRange: SourceRange = {
      start: { ...token.range.start, line: token.range.start.line - lineOffset },
      end: { ...token.range.end, line: token.range.end.line - lineOffset },
    };
    selector = findKeywordSelector(ast, astRange);
  }

  if (
    token.type === TokenType.BinarySelector ||
    token.type === TokenType.Minus ||
    token.type === TokenType.LessThan ||
    token.type === TokenType.GreaterThan
  ) {
    selector = token.text;
  }

  if (!selector) return null;

  const senders = index.findSenders(selector);
  if (senders.length === 0) return null;

  return senders.map(m => ({
    uri: m.uri,
    range: {
      start: { line: m.startLine, character: 0 },
      end: { line: m.endLine, character: 0 },
    },
  }));
}
