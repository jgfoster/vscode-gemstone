import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver';
import { ParsedDocument } from '../utils/documentManager';
import { Token, TokenType } from '../lexer/tokens';
import { MethodNode, BlockNode, StatementNode, ExpressionNode, PrimaryNode, MessageNode } from '../parser/ast';

export function getFoldingRanges(doc: ParsedDocument): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  // Fold blocks from AST
  if (doc.ast) {
    collectBlockFolds(doc.ast, ranges);
  }

  // Fold multi-line comments from tokens
  for (const token of doc.tokens) {
    if (token.type === TokenType.Comment) {
      const startLine = token.range.start.line;
      const endLine = token.range.end.line;
      if (endLine > startLine) {
        ranges.push({
          startLine,
          endLine,
          kind: FoldingRangeKind.Comment,
        });
      }
    }
  }

  return ranges;
}

function collectBlockFolds(method: MethodNode, ranges: FoldingRange[]): void {
  // Method body fold
  const startLine = method.range.start.line;
  const endLine = method.range.end.line;
  if (endLine > startLine) {
    ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
  }

  walkStatementsForFolds(method.body.statements, ranges);
}

function walkStatementsForFolds(statements: StatementNode[], ranges: FoldingRange[]): void {
  for (const stmt of statements) {
    walkStatementForFolds(stmt, ranges);
  }
}

function walkStatementForFolds(stmt: StatementNode, ranges: FoldingRange[]): void {
  switch (stmt.kind) {
    case 'Assignment':
      walkStatementForFolds(stmt.value, ranges);
      break;
    case 'Return':
      walkExpressionForFolds(stmt.expression, ranges);
      break;
    case 'Expression':
      walkExpressionForFolds(stmt, ranges);
      break;
  }
}

function walkExpressionForFolds(expr: ExpressionNode, ranges: FoldingRange[]): void {
  walkPrimaryForFolds(expr.receiver, ranges);
  for (const msg of expr.messages) {
    walkMessageForFolds(msg, ranges);
  }
  for (const cascade of expr.cascades) {
    walkMessageForFolds(cascade, ranges);
  }
}

function walkMessageForFolds(msg: MessageNode, ranges: FoldingRange[]): void {
  if (msg.kind === 'BinaryMessage') {
    walkExpressionForFolds(msg.argument, ranges);
  } else if (msg.kind === 'KeywordMessage') {
    for (const part of msg.parts) {
      walkExpressionForFolds(part.value, ranges);
    }
  }
}

function walkPrimaryForFolds(primary: PrimaryNode, ranges: FoldingRange[]): void {
  if (primary.kind === 'Block') {
    const block = primary as BlockNode;
    const startLine = block.range.start.line;
    const endLine = block.range.end.line;
    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
    }
    walkStatementsForFolds(block.statements, ranges);
  } else if (primary.kind === 'ParenExpression') {
    walkStatementForFolds(primary.expression, ranges);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      walkExpressionForFolds(expr, ranges);
    }
  }
}
