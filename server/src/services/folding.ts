import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver';
import { ParsedDocument } from '../utils/documentManager';
import { TokenType } from '../lexer/tokens';
import { MethodNode, BlockNode, StatementNode, ExpressionNode, PrimaryNode, MessageNode } from '../parser/ast';

export function getFoldingRanges(doc: ParsedDocument): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  if (doc.format === 'tonel') {
    // Fold Tonel file header (Class/Extension/Package)
    for (const region of doc.topazRegions) {
      if (region.kind === 'tonel-header' && region.endLine > region.startLine) {
        ranges.push({
          startLine: region.startLine,
          endLine: region.endLine,
          kind: FoldingRangeKind.Region,
        });
      }
    }
    // Fold each Tonel method from annotation to closing bracket
    for (const region of doc.topazRegions) {
      if (region.kind === 'smalltalk-method') {
        const foldStart = region.annotationStartLine ?? region.startLine;
        const foldEnd = region.closingBracketLine ?? region.endLine;
        if (foldEnd > foldStart) {
          ranges.push({
            startLine: foldStart,
            endLine: foldEnd,
            kind: FoldingRangeKind.Region,
          });
        }
      }
    }
  } else {
    // Fold each Topaz Smalltalk region (command line to %)
    for (const region of doc.topazRegions) {
      if (region.kind !== 'topaz') {
        // The region spans from startLine to endLine, but the Topaz command
        // is on startLine-1 and % is on endLine+1
        const commandLine = region.startLine > 0 ? region.startLine - 1 : region.startLine;
        const terminatorLine = region.endLine + 1;
        if (terminatorLine > commandLine) {
          ranges.push({
            startLine: commandLine,
            endLine: terminatorLine,
            kind: FoldingRangeKind.Region,
          });
        }
      }
    }
  }

  // Fold blocks from AST in each parsed region
  for (const pr of doc.parsedRegions) {
    if (pr.ast) {
      collectBlockFolds(pr.ast, ranges, pr.region.startLine);
    }
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

function collectBlockFolds(method: MethodNode, ranges: FoldingRange[], lineOffset: number): void {
  walkStatementsForFolds(method.body.statements, ranges, lineOffset);
}

function walkStatementsForFolds(statements: StatementNode[], ranges: FoldingRange[], off: number): void {
  for (const stmt of statements) {
    walkStatementForFolds(stmt, ranges, off);
  }
}

function walkStatementForFolds(stmt: StatementNode, ranges: FoldingRange[], off: number): void {
  switch (stmt.kind) {
    case 'Assignment':
      walkStatementForFolds(stmt.value, ranges, off);
      break;
    case 'Return':
      walkExpressionForFolds(stmt.expression, ranges, off);
      break;
    case 'Expression':
      walkExpressionForFolds(stmt, ranges, off);
      break;
  }
}

function walkExpressionForFolds(expr: ExpressionNode, ranges: FoldingRange[], off: number): void {
  walkPrimaryForFolds(expr.receiver, ranges, off);
  for (const msg of expr.messages) {
    walkMessageForFolds(msg, ranges, off);
  }
  for (const cascade of expr.cascades) {
    walkMessageForFolds(cascade, ranges, off);
  }
}

function walkMessageForFolds(msg: MessageNode, ranges: FoldingRange[], off: number): void {
  if (msg.kind === 'BinaryMessage') {
    walkExpressionForFolds(msg.argument, ranges, off);
  } else if (msg.kind === 'KeywordMessage') {
    for (const part of msg.parts) {
      walkExpressionForFolds(part.value, ranges, off);
    }
  }
}

function walkPrimaryForFolds(primary: PrimaryNode, ranges: FoldingRange[], off: number): void {
  if (primary.kind === 'Block') {
    const block = primary as BlockNode;
    const startLine = block.range.start.line + off;
    const endLine = block.range.end.line + off;
    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
    }
    walkStatementsForFolds(block.statements, ranges, off);
  } else if (primary.kind === 'ParenExpression') {
    walkStatementForFolds(primary.expression, ranges, off);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      walkExpressionForFolds(expr, ranges, off);
    }
  }
}
