import { SourceRange, SourcePosition } from '../lexer/tokens';
import {
  MethodNode, BlockNode, StatementNode, ExpressionNode,
  PrimaryNode, MessageNode, VariableNode,
} from '../parser/ast';

export type VariableKind = 'argument' | 'temporary' | 'blockParameter' | 'blockTemporary';

export interface VariableInfo {
  name: string;
  kind: VariableKind;
  definitionRange: SourceRange;
  scope: ScopeNode;
}

export interface ScopeNode {
  kind: 'method' | 'block';
  range: SourceRange;
  variables: VariableInfo[];
  parent?: ScopeNode;
  children: ScopeNode[];
}

export class ScopeAnalyzer {
  analyze(method: MethodNode): ScopeNode {
    const methodScope: ScopeNode = {
      kind: 'method',
      range: method.range,
      variables: [],
      children: [],
    };

    // Add method arguments
    const pattern = method.pattern;
    if (pattern.kind === 'BinaryPattern') {
      this.addVariable(methodScope, pattern.parameter, 'argument');
    } else if (pattern.kind === 'KeywordPattern') {
      for (const param of pattern.parameters) {
        this.addVariable(methodScope, param, 'argument');
      }
    }

    // Add temporaries
    for (const temp of method.body.temporaries) {
      this.addVariable(methodScope, temp, 'temporary');
    }

    // Walk statements for nested blocks
    this.walkStatements(method.body.statements, methodScope);

    return methodScope;
  }

  findVariableAt(root: ScopeNode, name: string, position: SourcePosition): VariableInfo | null {
    const scope = this.findScopeAt(root, position);
    return this.lookupVariable(scope, name);
  }

  allVisibleVariables(root: ScopeNode, position: SourcePosition): VariableInfo[] {
    const scope = this.findScopeAt(root, position);
    const result: VariableInfo[] = [];
    const seen = new Set<string>();

    let current: ScopeNode | undefined = scope;
    while (current) {
      for (const v of current.variables) {
        if (!seen.has(v.name)) {
          seen.add(v.name);
          result.push(v);
        }
      }
      current = current.parent;
    }

    return result;
  }

  findScopeAt(root: ScopeNode, position: SourcePosition): ScopeNode {
    for (const child of root.children) {
      if (this.containsPosition(child.range, position)) {
        return this.findScopeAt(child, position);
      }
    }
    return root;
  }

  private lookupVariable(scope: ScopeNode, name: string): VariableInfo | null {
    let current: ScopeNode | undefined = scope;
    while (current) {
      for (const v of current.variables) {
        if (v.name === name) return v;
      }
      current = current.parent;
    }
    return null;
  }

  private addVariable(scope: ScopeNode, variable: VariableNode, kind: VariableKind): void {
    scope.variables.push({
      name: variable.name,
      kind,
      definitionRange: variable.range,
      scope,
    });
  }

  private walkStatements(statements: StatementNode[], scope: ScopeNode): void {
    for (const stmt of statements) {
      this.walkStatement(stmt, scope);
    }
  }

  private walkStatement(stmt: StatementNode, scope: ScopeNode): void {
    switch (stmt.kind) {
      case 'Assignment':
        this.walkStatement(stmt.value, scope);
        break;
      case 'Return':
        this.walkExpression(stmt.expression, scope);
        break;
      case 'Expression':
        this.walkExpression(stmt, scope);
        break;
    }
  }

  private walkExpression(expr: ExpressionNode, scope: ScopeNode): void {
    this.walkPrimary(expr.receiver, scope);
    for (const msg of expr.messages) {
      this.walkMessage(msg, scope);
    }
    for (const cascade of expr.cascades) {
      this.walkMessage(cascade, scope);
    }
  }

  private walkMessage(msg: MessageNode, scope: ScopeNode): void {
    if (msg.kind === 'BinaryMessage') {
      this.walkExpression(msg.argument, scope);
    } else if (msg.kind === 'KeywordMessage') {
      for (const part of msg.parts) {
        this.walkExpression(part.value, scope);
      }
    }
  }

  private walkPrimary(primary: PrimaryNode, scope: ScopeNode): void {
    switch (primary.kind) {
      case 'Block':
        this.walkBlock(primary as BlockNode, scope);
        break;
      case 'SelectionBlock':
        // Selection block has a parameter and predicate
        {
          const selBlock = primary;
          const blockScope = this.createBlockScope(selBlock.range, scope);
          this.addVariable(blockScope, selBlock.parameter, 'blockParameter');
          this.walkExpression(selBlock.predicate, blockScope);
        }
        break;
      case 'ParenExpression':
        this.walkStatement(primary.expression, scope);
        break;
      case 'CurlyArrayBuilder':
        for (const expr of primary.expressions) {
          this.walkExpression(expr, scope);
        }
        break;
    }
  }

  private walkBlock(block: BlockNode, parentScope: ScopeNode): void {
    const blockScope = this.createBlockScope(block.range, parentScope);

    for (const param of block.parameters) {
      this.addVariable(blockScope, param, 'blockParameter');
    }

    for (const temp of block.temporaries) {
      this.addVariable(blockScope, temp, 'blockTemporary');
    }

    this.walkStatements(block.statements, blockScope);
  }

  private createBlockScope(range: SourceRange, parent: ScopeNode): ScopeNode {
    const scope: ScopeNode = {
      kind: 'block',
      range,
      variables: [],
      parent,
      children: [],
    };
    parent.children.push(scope);
    return scope;
  }

  private containsPosition(range: SourceRange, pos: SourcePosition): boolean {
    if (pos.line < range.start.line || pos.line > range.end.line) return false;
    if (pos.line === range.start.line && pos.column < range.start.column) return false;
    if (pos.line === range.end.line && pos.column > range.end.column) return false;
    return true;
  }
}
