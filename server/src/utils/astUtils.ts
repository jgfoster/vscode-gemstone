import { Position } from 'vscode-languageserver';
import { Token, TokenType, SourceRange } from '../lexer/tokens';
import {
  MethodNode, ExpressionNode, StatementNode, MessageNode, PrimaryNode,
} from '../parser/ast';

// ── Token lookup ────────────────────────────────────────────

export function findTokenAt(tokens: Token[], position: Position): Token | null {
  for (const token of tokens) {
    if (token.type === TokenType.Whitespace || token.type === TokenType.EOF) continue;
    const r = token.range;
    if (position.line >= r.start.line && position.line <= r.end.line) {
      if (position.line === r.start.line && position.character < r.start.column) continue;
      if (position.line === r.end.line && position.character >= r.end.column) continue;
      return token;
    }
  }
  return null;
}

// ── Range utilities ─────────────────────────────────────────

export function rangeContains(outer: SourceRange, inner: SourceRange): boolean {
  if (inner.start.line < outer.start.line || inner.end.line > outer.end.line) return false;
  if (inner.start.line === outer.start.line && inner.start.column < outer.start.column) return false;
  if (inner.end.line === outer.end.line && inner.end.column > outer.end.column) return false;
  return true;
}

// ── AST keyword selector lookup ─────────────────────────────

export function findKeywordSelector(ast: MethodNode, tokenRange: SourceRange): string | null {
  // Check method pattern
  if (ast.pattern.kind === 'KeywordPattern' && rangeContains(ast.pattern.range, tokenRange)) {
    return ast.pattern.selector;
  }
  // Walk body statements
  for (const stmt of ast.body.statements) {
    const result = findSelectorInStatement(stmt, tokenRange);
    if (result) return result;
  }
  return null;
}

function findSelectorInStatement(stmt: StatementNode, range: SourceRange): string | null {
  if (stmt.kind === 'Return') return findSelectorInExpression(stmt.expression, range);
  if (stmt.kind === 'Assignment') return findSelectorInStatement(stmt.value, range);
  return findSelectorInExpression(stmt, range);
}

function findSelectorInExpression(expr: ExpressionNode, range: SourceRange): string | null {
  for (const msg of expr.messages) {
    const result = findSelectorInMessage(msg, range);
    if (result) return result;
  }
  for (const msg of expr.cascades) {
    const result = findSelectorInMessage(msg, range);
    if (result) return result;
  }
  return findSelectorInPrimary(expr.receiver, range);
}

function findSelectorInMessage(msg: MessageNode, range: SourceRange): string | null {
  if (msg.kind === 'KeywordMessage') {
    // Check nested expressions first (inner keyword messages take priority)
    for (const part of msg.parts) {
      const result = findSelectorInExpression(part.value, range);
      if (result) return result;
    }
    if (rangeContains(msg.range, range)) return msg.selector;
  } else if (msg.kind === 'BinaryMessage') {
    return findSelectorInExpression(msg.argument, range);
  }
  return null;
}

function findSelectorInPrimary(primary: PrimaryNode, range: SourceRange): string | null {
  if (primary.kind === 'Block') {
    for (const stmt of primary.statements) {
      const result = findSelectorInStatement(stmt, range);
      if (result) return result;
    }
  } else if (primary.kind === 'ParenExpression') {
    return findSelectorInStatement(primary.expression, range);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      const result = findSelectorInExpression(expr, range);
      if (result) return result;
    }
  }
  return null;
}

// ── AST variable lookup (for identifiers not in method scope) ──

export function isVariableInAST(ast: MethodNode, range: SourceRange): boolean {
  for (const stmt of ast.body.statements) {
    if (isVarInStatement(stmt, range)) return true;
  }
  return false;
}

function isVarInStatement(stmt: StatementNode, range: SourceRange): boolean {
  if (stmt.kind === 'Assignment') {
    if (rangeContains(stmt.variable.range, range)) return true;
    return isVarInStatement(stmt.value, range);
  }
  if (stmt.kind === 'Return') return isVarInExpression(stmt.expression, range);
  return isVarInExpression(stmt, range);
}

function isVarInExpression(expr: ExpressionNode, range: SourceRange): boolean {
  if (isVarInPrimary(expr.receiver, range)) return true;
  for (const msg of expr.messages) {
    if (isVarInMessage(msg, range)) return true;
  }
  for (const msg of expr.cascades) {
    if (isVarInMessage(msg, range)) return true;
  }
  return false;
}

function isVarInPrimary(primary: PrimaryNode, range: SourceRange): boolean {
  if (primary.kind === 'Variable') {
    return rangeContains(primary.range, range);
  }
  if (primary.kind === 'Block') {
    for (const stmt of primary.statements) {
      if (isVarInStatement(stmt, range)) return true;
    }
  } else if (primary.kind === 'SelectionBlock') {
    return isVarInExpression(primary.predicate, range);
  } else if (primary.kind === 'ParenExpression') {
    return isVarInStatement(primary.expression, range);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      if (isVarInExpression(expr, range)) return true;
    }
  }
  return false;
}

function isVarInMessage(msg: MessageNode, range: SourceRange): boolean {
  if (msg.kind === 'BinaryMessage') {
    return isVarInExpression(msg.argument, range);
  }
  if (msg.kind === 'KeywordMessage') {
    for (const part of msg.parts) {
      if (isVarInExpression(part.value, range)) return true;
    }
  }
  return false;
}

// ── Selector at position (for definition, references, custom LSP) ──

/**
 * Find the selector at a given document position.
 * Returns the composed selector string (e.g. 'at:put:') or null
 * if the token at the position is not a selector (e.g. it's a variable or literal).
 */
export function findSelectorAtPosition(
  tokens: Token[],
  ast: MethodNode | null,
  position: Position,
  lineOffset: number,
): string | null {
  const token = findTokenAt(tokens, position);
  if (!token || !ast) return null;

  // Identifier that isn't a variable in the AST → unary selector
  if (token.type === TokenType.Identifier) {
    const astRange = offsetRangeBack(token.range, lineOffset);
    if (!isVariableInAST(ast, astRange)) {
      return token.text;
    }
    return null;
  }

  // Keyword → compose full selector from AST
  if (token.type === TokenType.Keyword) {
    const astRange = offsetRangeBack(token.range, lineOffset);
    return findKeywordSelector(ast, astRange);
  }

  // Binary selector
  if (
    token.type === TokenType.BinarySelector ||
    token.type === TokenType.Minus ||
    token.type === TokenType.LessThan ||
    token.type === TokenType.GreaterThan
  ) {
    return token.text;
  }

  return null;
}

/** Shift a document-level range back to AST-local coordinates. */
function offsetRangeBack(range: SourceRange, lineOffset: number): SourceRange {
  return {
    start: { ...range.start, line: range.start.line - lineOffset },
    end: { ...range.end, line: range.end.line - lineOffset },
  };
}

// ── Sent selector collection (for workspace index) ──────────

export function collectSentSelectors(method: MethodNode): Set<string> {
  const selectors = new Set<string>();
  collectFromStatements(method.body.statements, selectors);
  return selectors;
}

function collectFromStatements(stmts: StatementNode[], selectors: Set<string>): void {
  for (const stmt of stmts) {
    collectFromStatement(stmt, selectors);
  }
}

function collectFromStatement(stmt: StatementNode, selectors: Set<string>): void {
  if (stmt.kind === 'Assignment') {
    collectFromStatement(stmt.value, selectors);
  } else if (stmt.kind === 'Return') {
    collectFromExpression(stmt.expression, selectors);
  } else {
    collectFromExpression(stmt, selectors);
  }
}

function collectFromExpression(expr: ExpressionNode, selectors: Set<string>): void {
  collectFromPrimary(expr.receiver, selectors);
  for (const msg of expr.messages) {
    selectors.add(msg.selector);
    collectFromMessage(msg, selectors);
  }
  for (const cascade of expr.cascades) {
    selectors.add(cascade.selector);
    collectFromMessage(cascade, selectors);
  }
}

function collectFromMessage(msg: MessageNode, selectors: Set<string>): void {
  if (msg.kind === 'BinaryMessage') {
    collectFromExpression(msg.argument, selectors);
  } else if (msg.kind === 'KeywordMessage') {
    for (const part of msg.parts) {
      collectFromExpression(part.value, selectors);
    }
  }
}

function collectFromPrimary(primary: PrimaryNode, selectors: Set<string>): void {
  if (primary.kind === 'Block') {
    collectFromStatements(primary.statements, selectors);
  } else if (primary.kind === 'SelectionBlock') {
    collectFromExpression(primary.predicate, selectors);
  } else if (primary.kind === 'ParenExpression') {
    collectFromStatement(primary.expression, selectors);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      collectFromExpression(expr, selectors);
    }
  }
}
