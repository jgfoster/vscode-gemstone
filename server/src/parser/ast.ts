import { SourceRange } from '../lexer/tokens';

export interface ASTNode {
  kind: string;
  range: SourceRange;
}

// ── Top-level ──────────────────────────────────────────────

export interface MethodNode extends ASTNode {
  kind: 'Method';
  pattern: MessagePatternNode;
  primitive?: PrimitiveNode;
  body: MethodBodyNode;
}

export interface MethodBodyNode extends ASTNode {
  kind: 'MethodBody';
  pragmas: PragmaNode[];
  temporaries: VariableNode[];
  statements: StatementNode[];
}

// ── Message Patterns ───────────────────────────────────────

export type MessagePatternNode =
  | UnaryPatternNode
  | BinaryPatternNode
  | KeywordPatternNode;

export interface UnaryPatternNode extends ASTNode {
  kind: 'UnaryPattern';
  selector: string;
}

export interface BinaryPatternNode extends ASTNode {
  kind: 'BinaryPattern';
  selector: string;
  parameter: VariableNode;
}

export interface KeywordPatternNode extends ASTNode {
  kind: 'KeywordPattern';
  keywords: string[];
  parameters: VariableNode[];
  selector: string;
}

// ── Statements ─────────────────────────────────────────────

export type StatementNode = AssignmentNode | ReturnNode | ExpressionNode;

export interface ReturnNode extends ASTNode {
  kind: 'Return';
  expression: ExpressionNode;
}

export interface AssignmentNode extends ASTNode {
  kind: 'Assignment';
  variable: VariableNode;
  value: StatementNode;
}

// ── Expressions ────────────────────────────────────────────

export interface ExpressionNode extends ASTNode {
  kind: 'Expression';
  receiver: PrimaryNode;
  messages: MessageNode[];
  cascades: MessageNode[];
}

export type MessageNode =
  | UnaryMessageNode
  | BinaryMessageNode
  | KeywordMessageNode;

export interface UnaryMessageNode extends ASTNode {
  kind: 'UnaryMessage';
  selector: string;
  envSpecifier?: string;
}

export interface BinaryMessageNode extends ASTNode {
  kind: 'BinaryMessage';
  selector: string;
  argument: ExpressionNode;
  envSpecifier?: string;
}

export interface KeywordMessageNode extends ASTNode {
  kind: 'KeywordMessage';
  parts: KeywordPartNode[];
  selector: string;
  envSpecifier?: string;
}

export interface KeywordPartNode extends ASTNode {
  kind: 'KeywordPart';
  keyword: string;
  value: ExpressionNode;
}

// ── Primaries ──────────────────────────────────────────────

export type PrimaryNode =
  | LiteralNode
  | VariableNode
  | BlockNode
  | SelectionBlockNode
  | ParenExpressionNode
  | CurlyArrayBuilderNode
  | PathNode;

export interface VariableNode extends ASTNode {
  kind: 'Variable';
  name: string;
}

export interface PathNode extends ASTNode {
  kind: 'Path';
  segments: string[];
}

export interface BlockNode extends ASTNode {
  kind: 'Block';
  parameters: VariableNode[];
  temporaries: VariableNode[];
  statements: StatementNode[];
}

export interface SelectionBlockNode extends ASTNode {
  kind: 'SelectionBlock';
  parameter: VariableNode;
  predicate: ExpressionNode;
}

export interface ParenExpressionNode extends ASTNode {
  kind: 'ParenExpression';
  expression: StatementNode;
}

export interface CurlyArrayBuilderNode extends ASTNode {
  kind: 'CurlyArrayBuilder';
  expressions: ExpressionNode[];
}

// ── Literals ───────────────────────────────────────────────

export type LiteralNode =
  | NumberLiteralNode
  | StringLiteralNode
  | SymbolLiteralNode
  | CharacterLiteralNode
  | ArrayLiteralNode
  | ByteArrayLiteralNode
  | SpecialLiteralNode;

export interface NumberLiteralNode extends ASTNode {
  kind: 'NumberLiteral';
  value: string;
}

export interface StringLiteralNode extends ASTNode {
  kind: 'StringLiteral';
  value: string;
}

export interface SymbolLiteralNode extends ASTNode {
  kind: 'SymbolLiteral';
  value: string;
}

export interface CharacterLiteralNode extends ASTNode {
  kind: 'CharacterLiteral';
  value: string;
}

export interface ArrayLiteralNode extends ASTNode {
  kind: 'ArrayLiteral';
  items: ArrayItemNode[];
}

export type ArrayItemNode =
  | NumberLiteralNode
  | SymbolLiteralNode
  | StringLiteralNode
  | CharacterLiteralNode
  | ArrayLiteralNode
  | ByteArrayLiteralNode
  | SpecialLiteralNode;

export interface ByteArrayLiteralNode extends ASTNode {
  kind: 'ByteArrayLiteral';
  values: NumberLiteralNode[];
}

export interface SpecialLiteralNode extends ASTNode {
  kind: 'SpecialLiteral';
  value: 'true' | 'false' | 'nil' | '_remoteNil';
}

// ── Pragmas ────────────────────────────────────────────────

export interface PragmaNode extends ASTNode {
  kind: 'Pragma';
  body: UnaryPragmaNode | KeywordPragmaNode;
}

export interface UnaryPragmaNode extends ASTNode {
  kind: 'UnaryPragma';
  selector: string;
}

export interface KeywordPragmaNode extends ASTNode {
  kind: 'KeywordPragma';
  pairs: PragmaPairNode[];
}

export interface PragmaPairNode extends ASTNode {
  kind: 'PragmaPair';
  keyword: string;
  literal: LiteralNode;
}

export interface PrimitiveNode extends ASTNode {
  kind: 'Primitive';
  protection?: 'protected' | 'unprotected';
  number?: number;
}
