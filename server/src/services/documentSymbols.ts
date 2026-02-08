import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { MethodNode, BlockNode, StatementNode, ExpressionNode, PrimaryNode, MessageNode, VariableNode } from '../parser/ast';
import { SourceRange } from '../lexer/tokens';

function toLspRange(range: SourceRange) {
  return {
    start: { line: range.start.line, character: range.start.column },
    end: { line: range.end.line, character: range.end.column },
  };
}

export function getDocumentSymbols(method: MethodNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  const methodSymbol: DocumentSymbol = {
    name: method.pattern.selector,
    kind: SymbolKind.Method,
    range: toLspRange(method.range),
    selectionRange: toLspRange(method.pattern.range),
    children: [],
  };

  // Add temporaries as children
  for (const temp of method.body.temporaries) {
    methodSymbol.children!.push({
      name: temp.name,
      kind: SymbolKind.Variable,
      range: toLspRange(temp.range),
      selectionRange: toLspRange(temp.range),
    });
  }

  // Add arguments as children
  if (method.pattern.kind === 'BinaryPattern') {
    methodSymbol.children!.push({
      name: method.pattern.parameter.name,
      kind: SymbolKind.Variable,
      range: toLspRange(method.pattern.parameter.range),
      selectionRange: toLspRange(method.pattern.parameter.range),
      detail: 'argument',
    });
  } else if (method.pattern.kind === 'KeywordPattern') {
    for (const param of method.pattern.parameters) {
      methodSymbol.children!.push({
        name: param.name,
        kind: SymbolKind.Variable,
        range: toLspRange(param.range),
        selectionRange: toLspRange(param.range),
        detail: 'argument',
      });
    }
  }

  // Walk statements for blocks
  collectBlockSymbols(method.body.statements, methodSymbol.children!);

  symbols.push(methodSymbol);
  return symbols;
}

function collectBlockSymbols(statements: StatementNode[], symbols: DocumentSymbol[]): void {
  for (const stmt of statements) {
    collectFromStatement(stmt, symbols);
  }
}

function collectFromStatement(stmt: StatementNode, symbols: DocumentSymbol[]): void {
  switch (stmt.kind) {
    case 'Assignment':
      collectFromStatement(stmt.value, symbols);
      break;
    case 'Return':
      collectFromExpression(stmt.expression, symbols);
      break;
    case 'Expression':
      collectFromExpression(stmt, symbols);
      break;
  }
}

function collectFromExpression(expr: ExpressionNode, symbols: DocumentSymbol[]): void {
  collectFromPrimary(expr.receiver, symbols);
  for (const msg of expr.messages) {
    collectFromMessage(msg, symbols);
  }
  for (const cascade of expr.cascades) {
    collectFromMessage(cascade, symbols);
  }
}

function collectFromMessage(msg: MessageNode, symbols: DocumentSymbol[]): void {
  if (msg.kind === 'BinaryMessage') {
    collectFromExpression(msg.argument, symbols);
  } else if (msg.kind === 'KeywordMessage') {
    for (const part of msg.parts) {
      collectFromExpression(part.value, symbols);
    }
  }
}

function collectFromPrimary(primary: PrimaryNode, symbols: DocumentSymbol[]): void {
  if (primary.kind === 'Block') {
    const block = primary as BlockNode;
    const blockSymbol: DocumentSymbol = {
      name: block.parameters.length > 0
        ? `[:${block.parameters.map((p) => p.name).join(' :')} | ...]`
        : '[...]',
      kind: SymbolKind.Function,
      range: toLspRange(block.range),
      selectionRange: toLspRange(block.range),
      children: [],
    };

    for (const param of block.parameters) {
      blockSymbol.children!.push({
        name: param.name,
        kind: SymbolKind.Variable,
        range: toLspRange(param.range),
        selectionRange: toLspRange(param.range),
        detail: 'block parameter',
      });
    }

    for (const temp of block.temporaries) {
      blockSymbol.children!.push({
        name: temp.name,
        kind: SymbolKind.Variable,
        range: toLspRange(temp.range),
        selectionRange: toLspRange(temp.range),
        detail: 'block temporary',
      });
    }

    collectBlockSymbols(block.statements, blockSymbol.children!);
    symbols.push(blockSymbol);
  } else if (primary.kind === 'ParenExpression') {
    collectFromStatement(primary.expression, symbols);
  } else if (primary.kind === 'CurlyArrayBuilder') {
    for (const expr of primary.expressions) {
      collectFromExpression(expr, symbols);
    }
  }
}
