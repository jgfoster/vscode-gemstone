import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { MethodNode, BlockNode, StatementNode, ExpressionNode, PrimaryNode, MessageNode } from '../parser/ast';
import { SourceRange } from '../lexer/tokens';
import { TopazRegion } from '../topaz/topazParser';

function toLspRange(range: SourceRange, lineOffset: number) {
  return {
    start: { line: range.start.line + lineOffset, character: range.start.column },
    end: { line: range.end.line + lineOffset, character: range.end.column },
  };
}

export function getDocumentSymbols(method: MethodNode, region?: TopazRegion): DocumentSymbol[] {
  const off = region?.startLine ?? 0;
  const symbols: DocumentSymbol[] = [];

  const className = region?.className;
  const methodName = className
    ? `${className} >> ${method.pattern.selector}`
    : method.pattern.selector;

  const methodSymbol: DocumentSymbol = {
    name: methodName,
    kind: SymbolKind.Method,
    range: toLspRange(method.range, off),
    selectionRange: toLspRange(method.pattern.range, off),
    children: [],
  };

  // Add temporaries as children
  for (const temp of method.body.temporaries) {
    methodSymbol.children!.push({
      name: temp.name,
      kind: SymbolKind.Variable,
      range: toLspRange(temp.range, off),
      selectionRange: toLspRange(temp.range, off),
    });
  }

  // Add arguments as children
  if (method.pattern.kind === 'BinaryPattern') {
    methodSymbol.children!.push({
      name: method.pattern.parameter.name,
      kind: SymbolKind.Variable,
      range: toLspRange(method.pattern.parameter.range, off),
      selectionRange: toLspRange(method.pattern.parameter.range, off),
      detail: 'argument',
    });
  } else if (method.pattern.kind === 'KeywordPattern') {
    for (const param of method.pattern.parameters) {
      methodSymbol.children!.push({
        name: param.name,
        kind: SymbolKind.Variable,
        range: toLspRange(param.range, off),
        selectionRange: toLspRange(param.range, off),
        detail: 'argument',
      });
    }
  }

  // Walk statements for blocks
  collectBlockSymbols(method.body.statements, methodSymbol.children!, off);

  symbols.push(methodSymbol);
  return symbols;
}

function collectBlockSymbols(statements: StatementNode[], symbols: DocumentSymbol[], off: number): void {
  for (const stmt of statements) {
    collectFromStatement(stmt, symbols, off);
  }
}

function collectFromStatement(stmt: StatementNode, symbols: DocumentSymbol[], off: number): void {
  switch (stmt.kind) {
    case 'Assignment':
      collectFromStatement(stmt.value, symbols, off);
      break;
    case 'Return':
      collectFromExpression(stmt.expression, symbols, off);
      break;
    case 'Expression':
      collectFromExpression(stmt, symbols, off);
      break;
  }
}

function collectFromExpression(expr: ExpressionNode, symbols: DocumentSymbol[], off: number): void {
  collectFromPrimary(expr.receiver, symbols, off);
  for (const msg of expr.messages) {
    collectFromMessage(msg, symbols, off);
  }
  for (const cascade of expr.cascades) {
    collectFromMessage(cascade, symbols, off);
  }
}

function collectFromMessage(msg: MessageNode, symbols: DocumentSymbol[], off: number): void {
  if (msg.kind === 'BinaryMessage') {
    collectFromExpression(msg.argument, symbols, off);
  } else if (msg.kind === 'KeywordMessage') {
    for (const part of msg.parts) {
      collectFromExpression(part.value, symbols, off);
    }
  }
}

function collectFromPrimary(primary: PrimaryNode, symbols: DocumentSymbol[], off: number): void {
  if (primary.kind === 'Block') {
    const block = primary as BlockNode;
    const blockSymbol: DocumentSymbol = {
      name: block.parameters.length > 0
        ? `[:${block.parameters.map((p) => p.name).join(' :')} | ...]`
        : '[...]',
      kind: SymbolKind.Function,
      range: toLspRange(block.range, off),
      selectionRange: toLspRange(block.range, off),
      children: [],
    };

    for (const param of block.parameters) {
      blockSymbol.children!.push({
        name: param.name,
        kind: SymbolKind.Variable,
        range: toLspRange(param.range, off),
        selectionRange: toLspRange(param.range, off),
        detail: 'block parameter',
      });
    }

    for (const temp of block.temporaries) {
      blockSymbol.children!.push({
        name: temp.name,
        kind: SymbolKind.Variable,
        range: toLspRange(temp.range, off),
        selectionRange: toLspRange(temp.range, off),
        detail: 'block temporary',
      });
    }

    collectBlockSymbols(block.statements, blockSymbol.children!, off);
    symbols.push(blockSymbol);
  } else if (primary.kind === 'ParenExpression') {
    collectFromStatement(primary.expression, symbols, off);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      collectFromExpression(expr, symbols, off);
    }
  }
}
