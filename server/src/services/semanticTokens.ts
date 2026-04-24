import { Token, TokenType, SourceRange } from '../lexer/tokens';
import {
  MethodNode, ExpressionNode, StatementNode, MessageNode,
  PrimaryNode, BlockNode, LiteralNode, VariableNode,
  KeywordMessageNode, BinaryMessageNode, SelectionBlockNode,
} from '../parser/ast';
import { ScopeAnalyzer, ScopeNode } from '../utils/scopeAnalyzer';
import { isVariableInAST } from '../utils/astUtils';

// ── Token Legend ────────────────────────────────────────────

export const SEMANTIC_TOKEN_TYPES = [
  'variable',   // 0 — local temps, block temps
  'parameter',  // 1 — method arguments, block parameters
  'property',   // 2 — instance variables (not in method scope)
  'keyword',    // 3 — pseudo-variables: self, super, thisContext
  'number',     // 4 — NumberLiteral
  'string',     // 5 — StringLiteral, CharacterLiteral
  'type',       // 6 — SpecialLiteral (true, false, nil)
  'method',     // 7 — message selectors
  'namespace',  // 8 — SymbolLiteral
];

export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration', // bit 0
  'readonly',    // bit 1
];

const MOD_DECLARATION = 1 << 0;
const MOD_READONLY = 1 << 1;

const PSEUDO_VARIABLES = new Set(['self', 'super', 'thisContext']);

// ── Raw token type ──────────────────────────────────────────

interface RawSemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  modifiers: number;
}

// ── Collector ───────────────────────────────────────────────

export function collectSemanticTokens(
  ast: MethodNode,
  tokens: Token[],
  lineOffset: number,
  scopeRoot: ScopeNode,
  selectorColumnOffset: number = 0,
): RawSemanticToken[] {
  const result: RawSemanticToken[] = [];
  const analyzer = new ScopeAnalyzer();

  function push(range: SourceRange, tokenType: number, modifiers: number = 0): void {
    // For multi-line tokens, just use the first line
    const length = range.start.line === range.end.line
      ? range.end.column - range.start.column
      : range.end.column; // approximate for multi-line (rare)
    if (length <= 0) return;
    result.push({
      line: range.start.line + lineOffset,
      startChar: range.start.line === 0 ? range.start.column + selectorColumnOffset : range.start.column,
      length,
      tokenType,
      modifiers,
    });
  }

  // Tokens are already at document-level coordinates — no lineOffset needed
  function pushFromToken(token: Token, tokenType: number, modifiers: number = 0): void {
    result.push({
      line: token.range.start.line,
      startChar: token.range.start.column,
      length: token.text.length,
      tokenType,
      modifiers,
    });
  }

  // Convert an AST-local range to document-level for token lookup
  function toDocRange(range: SourceRange): SourceRange {
    return {
      start: { ...range.start, line: range.start.line + lineOffset, column: range.start.line === 0 ? range.start.column + selectorColumnOffset : range.start.column },
      end: { ...range.end, line: range.end.line + lineOffset, column: range.end.line === 0 ? range.end.column + selectorColumnOffset : range.end.column },
    };
  }

  // ── Method pattern ─────────────────────────────────────

  const pattern = ast.pattern;
  if (pattern.kind === 'UnaryPattern') {
    push(pattern.range, 7, MOD_DECLARATION); // method + declaration
  } else if (pattern.kind === 'BinaryPattern') {
    // The selector is the binary operator, parameter is the argument
    // Find selector token — it's the part of the range before the parameter
    const selectorEnd = pattern.parameter.range.start;
    if (pattern.range.start.line === selectorEnd.line) {
      result.push({
        line: pattern.range.start.line + lineOffset,
        startChar: pattern.range.start.line === 0 ? pattern.range.start.column + selectorColumnOffset : pattern.range.start.column,
        length: pattern.selector.length,
        tokenType: 7,
        modifiers: MOD_DECLARATION,
      });
    }
    push(pattern.parameter.range, 1, MOD_DECLARATION | MOD_READONLY); // parameter + declaration + readonly
  } else if (pattern.kind === 'KeywordPattern') {
    // Find keyword tokens in the source tokens array (tokens are document-level)
    const docPatternRange = toDocRange(pattern.range);
    for (const token of tokens) {
      if (token.type === TokenType.Keyword && isInRange(token.range, docPatternRange)) {
        pushFromToken(token, 7, MOD_DECLARATION);
      }
    }
    for (const param of pattern.parameters) {
      push(param.range, 1, MOD_DECLARATION | MOD_READONLY);
    }
  }

  // ── Temporaries ────────────────────────────────────────

  for (const temp of ast.body.temporaries) {
    push(temp.range, 0, MOD_DECLARATION); // variable + declaration
  }

  // ── Walk body ──────────────────────────────────────────

  function walkStatements(stmts: StatementNode[]): void {
    for (const stmt of stmts) walkStatement(stmt);
  }

  function walkStatement(stmt: StatementNode): void {
    switch (stmt.kind) {
      case 'Assignment':
        walkVariable(stmt.variable);
        walkStatement(stmt.value);
        break;
      case 'Return':
        walkExpression(stmt.expression);
        break;
      case 'Expression':
        walkExpression(stmt);
        break;
    }
  }

  function walkExpression(expr: ExpressionNode): void {
    walkPrimary(expr.receiver);
    for (const msg of expr.messages) walkMessage(msg);
    for (const cascade of expr.cascades) walkMessage(cascade);
  }

  function walkMessage(msg: MessageNode): void {
    if (msg.kind === 'UnaryMessage') {
      // Find the selector token in the source (tokens are doc-level, AST ranges are local)
      const docRange = toDocRange(msg.range);
      const selectorToken = findTokenInRange(tokens, docRange, TokenType.Identifier, msg.selector);
      if (selectorToken) {
        pushFromToken(selectorToken, 7); // method
      } else {
        // Fallback: use the AST range
        push(msg.range, 7);
      }
    } else if (msg.kind === 'BinaryMessage') {
      const docRange = toDocRange(msg.range);
      const selectorToken = findBinarySelectorToken(tokens, docRange, msg.selector);
      if (selectorToken) {
        pushFromToken(selectorToken, 7);
      }
      walkExpression((msg as BinaryMessageNode).argument);
    } else if (msg.kind === 'KeywordMessage') {
      const kwMsg = msg as KeywordMessageNode;
      for (const part of kwMsg.parts) {
        const docPartRange = toDocRange(part.range);
        for (const token of tokens) {
          if (token.type === TokenType.Keyword && isInRange(token.range, docPartRange)) {
            pushFromToken(token, 7); // method
            break; // one keyword per part
          }
        }
        walkExpression(part.value);
      }
    }
  }

  function walkPrimary(primary: PrimaryNode): void {
    switch (primary.kind) {
      case 'Variable':
        walkVariable(primary);
        break;
      case 'Block':
        walkBlock(primary as BlockNode);
        break;
      case 'SelectionBlock':
        walkSelectionBlock(primary as SelectionBlockNode);
        break;
      case 'ParenExpression':
        walkStatement(primary.expression);
        break;
      case 'CurlyArrayBuilder':
        for (const expr of primary.expressions) walkExpression(expr);
        break;
      case 'Path':
        // No semantic token for path segments
        break;
      default:
        // Literal
        if (isLiteral(primary.kind)) {
          walkLiteral(primary as LiteralNode);
        }
        break;
    }
  }

  function walkVariable(variable: VariableNode): void {
    // Check pseudo-variables first
    if (PSEUDO_VARIABLES.has(variable.name)) {
      push(variable.range, 3); // keyword
      return;
    }

    // Look up in scope
    const pos = variable.range.start;
    const varInfo = analyzer.findVariableAt(scopeRoot, variable.name, pos);
    if (varInfo) {
      if (varInfo.kind === 'argument' || varInfo.kind === 'blockParameter') {
        push(variable.range, 1, MOD_READONLY); // parameter + readonly
      } else {
        push(variable.range, 0); // variable
      }
    } else {
      // Not in scope — check if it's a variable in the AST (instance var)
      const astRange: SourceRange = {
        start: { ...variable.range.start },
        end: { ...variable.range.end },
      };
      if (isVariableInAST(ast, astRange)) {
        push(variable.range, 2); // property (instance variable)
      }
      // else: could be a global, class reference, etc. — leave uncolored
    }
  }

  function walkBlock(block: BlockNode): void {
    for (const param of block.parameters) {
      push(param.range, 1, MOD_DECLARATION | MOD_READONLY); // parameter + declaration + readonly
    }
    for (const temp of block.temporaries) {
      push(temp.range, 0, MOD_DECLARATION); // variable + declaration
    }
    walkStatements(block.statements);
  }

  function walkSelectionBlock(block: SelectionBlockNode): void {
    push(block.parameter.range, 1, MOD_DECLARATION | MOD_READONLY);
    walkExpression(block.predicate);
  }

  function walkLiteral(literal: LiteralNode): void {
    switch (literal.kind) {
      case 'NumberLiteral':
        push(literal.range, 4); // number
        break;
      case 'StringLiteral':
      case 'CharacterLiteral':
        push(literal.range, 5); // string
        break;
      case 'SymbolLiteral':
        push(literal.range, 8); // namespace
        break;
      case 'SpecialLiteral':
        push(literal.range, 6); // type
        break;
      case 'ArrayLiteral':
        for (const item of literal.items) walkLiteral(item);
        break;
      case 'ByteArrayLiteral':
        for (const val of literal.values) walkLiteral(val);
        break;
    }
  }

  // Walk the method body
  walkStatements(ast.body.statements);

  return result;
}

// ── Encoder ─────────────────────────────────────────────────

export function encodeSemanticTokens(rawTokens: RawSemanticToken[]): number[] {
  // Sort by line, then by startChar
  rawTokens.sort((a, b) => a.line - b.line || a.startChar - b.startChar);

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of rawTokens) {
    const deltaLine = token.line - prevLine;
    const deltaStartChar = deltaLine === 0 ? token.startChar - prevChar : token.startChar;

    data.push(deltaLine, deltaStartChar, token.length, token.tokenType, token.modifiers);

    prevLine = token.line;
    prevChar = token.startChar;
  }

  return data;
}

// ── Helpers ─────────────────────────────────────────────────

function isInRange(inner: SourceRange, outer: SourceRange): boolean {
  if (inner.start.line < outer.start.line) return false;
  if (inner.end.line > outer.end.line) return false;
  if (inner.start.line === outer.start.line && inner.start.column < outer.start.column) return false;
  if (inner.end.line === outer.end.line && inner.end.column > outer.end.column) return false;
  return true;
}

function isLiteral(kind: string): boolean {
  return kind === 'NumberLiteral' || kind === 'StringLiteral' ||
    kind === 'SymbolLiteral' || kind === 'CharacterLiteral' ||
    kind === 'SpecialLiteral' || kind === 'ArrayLiteral' ||
    kind === 'ByteArrayLiteral';
}

function findTokenInRange(
  tokens: Token[], range: SourceRange, type: TokenType, text: string,
): Token | null {
  for (const token of tokens) {
    if (token.type === type && token.text === text && isInRange(token.range, range)) {
      return token;
    }
  }
  return null;
}

function findBinarySelectorToken(
  tokens: Token[], range: SourceRange, selector: string,
): Token | null {
  const binaryTypes = [
    TokenType.BinarySelector, TokenType.Minus,
    TokenType.LessThan, TokenType.GreaterThan,
  ];
  for (const token of tokens) {
    if (binaryTypes.includes(token.type) && token.text === selector && isInRange(token.range, range)) {
      return token;
    }
  }
  return null;
}
