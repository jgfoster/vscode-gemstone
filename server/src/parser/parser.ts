import { Token, TokenType, SourceRange, createRange, createPosition, SourcePosition } from '../lexer/tokens';
import { ParseError, ParseErrorCollector } from './errors';
import {
  MethodNode, MethodBodyNode, MessagePatternNode,
  UnaryPatternNode, BinaryPatternNode, KeywordPatternNode,
  StatementNode, ReturnNode, AssignmentNode, ExpressionNode,
  PrimaryNode, VariableNode, PathNode, BlockNode, SelectionBlockNode,
  ParenExpressionNode, CurlyArrayBuilderNode,
  MessageNode, UnaryMessageNode, BinaryMessageNode, KeywordMessageNode, KeywordPartNode,
  LiteralNode, NumberLiteralNode, StringLiteralNode, SymbolLiteralNode,
  CharacterLiteralNode, ArrayLiteralNode, ByteArrayLiteralNode, SpecialLiteralNode,
  ArrayItemNode,
  PragmaNode, UnaryPragmaNode, KeywordPragmaNode, PragmaPairNode,
  PrimitiveNode, ASTNode,
} from './ast';

export class Parser {
  private tokens: Token[];
  private pos: number;
  private errors: ParseErrorCollector;

  constructor(allTokens: Token[]) {
    // Filter out whitespace and comments for parsing
    this.tokens = allTokens.filter(
      (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.Comment
    );
    this.pos = 0;
    this.errors = new ParseErrorCollector();
  }

  parse(): { ast: MethodNode | null; errors: ParseError[] } {
    try {
      if (this.atEnd()) {
        return { ast: null, errors: this.errors.errors };
      }
      const ast = this.parseMethod();
      return { ast, errors: this.errors.errors };
    } catch {
      return { ast: null, errors: this.errors.errors };
    }
  }

  // ── Method ────────────────────────────────────────────

  private parseMethod(): MethodNode {
    const start = this.currentRange().start;
    const pattern = this.parseMessagePattern();
    const primitive = this.parsePrimitive();
    const body = this.parseMethodBody();
    return {
      kind: 'Method',
      pattern,
      primitive: primitive ?? undefined,
      body,
      range: this.rangeFrom(start),
    };
  }

  private parseMessagePattern(): MessagePatternNode {
    const start = this.currentRange().start;

    // Look ahead to determine pattern type
    if (this.check(TokenType.Keyword)) {
      return this.parseKeywordPattern(start);
    }

    if (this.check(TokenType.BinarySelector) || this.check(TokenType.Minus) ||
        this.check(TokenType.LessThan) || this.check(TokenType.GreaterThan) ||
        this.check(TokenType.Pipe)) {
      return this.parseBinaryPattern(start);
    }

    // Must be unary or start of keyword
    if (this.check(TokenType.Identifier)) {
      const id = this.advance();
      // After identifier, check if next is keyword (then this is unary and keywords are in body)
      // or if next is identifier (binary selector that looks like identifier?)
      // Unary pattern is just a single identifier
      return {
        kind: 'UnaryPattern',
        selector: id.text,
        range: this.rangeFrom(start),
      } as UnaryPatternNode;
    }

    this.addError('Expected method pattern');
    return {
      kind: 'UnaryPattern',
      selector: 'unknown',
      range: this.rangeFrom(start),
    } as UnaryPatternNode;
  }

  private parseBinaryPattern(start: SourcePosition): BinaryPatternNode {
    const selector = this.advance();
    const param = this.expectIdentifier('Expected parameter name after binary selector');
    return {
      kind: 'BinaryPattern',
      selector: selector.text,
      parameter: this.makeVariable(param),
      range: this.rangeFrom(start),
    };
  }

  private parseKeywordPattern(start: SourcePosition): KeywordPatternNode {
    const keywords: string[] = [];
    const parameters: VariableNode[] = [];

    while (this.check(TokenType.Keyword)) {
      const kw = this.advance();
      keywords.push(kw.text);
      const param = this.expectIdentifier('Expected parameter name after keyword');
      parameters.push(this.makeVariable(param));
    }

    return {
      kind: 'KeywordPattern',
      keywords,
      parameters,
      selector: keywords.join(''),
      range: this.rangeFrom(start),
    };
  }

  // ── Primitive ─────────────────────────────────────────

  private parsePrimitive(): PrimitiveNode | null {
    if (!this.check(TokenType.LessThan)) return null;

    const start = this.currentRange().start;
    this.advance(); // skip <

    let protection: 'protected' | 'unprotected' | undefined;
    let num: number | undefined;

    // Check for protection modifier
    if (this.check(TokenType.Identifier)) {
      const text = this.peek().text;
      if (text === 'protected' || text === 'unprotected') {
        protection = text as 'protected' | 'unprotected';
        this.advance();
      }
    }

    // Check for primitive: N
    if (this.check(TokenType.Keyword) && this.peek().text === 'primitive:') {
      this.advance(); // skip 'primitive:'
      if (this.check(TokenType.Integer)) {
        num = parseInt(this.advance().text, 10);
      }
    }

    // If we didn't consume anything specific to a primitive, this might be a pragma
    if (protection === undefined && num === undefined) {
      // Rewind - this is a pragma, not a primitive
      this.pos -= 1; // back to <
      return null;
    }

    this.expect(TokenType.GreaterThan, "Expected '>' to close primitive");

    return {
      kind: 'Primitive',
      protection,
      number: num,
      range: this.rangeFrom(start),
    };
  }

  // ── Method Body ───────────────────────────────────────

  private parseMethodBody(): MethodBodyNode {
    const start = this.currentRange().start;
    const pragmas = this.parsePragmas();
    const temporaries = this.parseTemporaries();
    const statements = this.parseStatements();

    return {
      kind: 'MethodBody',
      pragmas,
      temporaries,
      statements,
      range: this.rangeFrom(start),
    };
  }

  // ── Pragmas ───────────────────────────────────────────

  private parsePragmas(): PragmaNode[] {
    const pragmas: PragmaNode[] = [];
    while (this.check(TokenType.LessThan)) {
      pragmas.push(this.parsePragma());
    }
    return pragmas;
  }

  private parsePragma(): PragmaNode {
    const start = this.currentRange().start;
    this.advance(); // skip <

    let body: UnaryPragmaNode | KeywordPragmaNode;

    if (this.check(TokenType.Keyword)) {
      // Keyword pragma
      const pairs: PragmaPairNode[] = [];
      while (this.check(TokenType.Keyword) || this.check(TokenType.BinarySelector)) {
        const pairStart = this.currentRange().start;
        const keyword = this.advance().text;
        const literal = this.parsePragmaLiteral();
        pairs.push({
          kind: 'PragmaPair',
          keyword,
          literal,
          range: this.rangeFrom(pairStart),
        });
      }
      body = {
        kind: 'KeywordPragma',
        pairs,
        range: this.rangeFrom(start),
      };
    } else if (this.check(TokenType.BinarySelector)) {
      // Binary selector pragma
      const pairs: PragmaPairNode[] = [];
      const pairStart = this.currentRange().start;
      const keyword = this.advance().text;
      const literal = this.parsePragmaLiteral();
      pairs.push({
        kind: 'PragmaPair',
        keyword,
        literal,
        range: this.rangeFrom(pairStart),
      });
      body = {
        kind: 'KeywordPragma',
        pairs,
        range: this.rangeFrom(start),
      };
    } else {
      // Unary pragma or special literal
      const selector = this.check(TokenType.SpecialLiteral)
        ? this.advance().text
        : this.check(TokenType.Identifier)
          ? this.advance().text
          : 'unknown';
      body = {
        kind: 'UnaryPragma',
        selector,
        range: this.rangeFrom(start),
      };
    }

    this.expect(TokenType.GreaterThan, "Expected '>' to close pragma");

    return {
      kind: 'Pragma',
      body,
      range: this.rangeFrom(start),
    };
  }

  private parsePragmaLiteral(): LiteralNode {
    return this.parseLiteral();
  }

  // ── Temporaries ───────────────────────────────────────

  private parseTemporaries(): VariableNode[] {
    if (!this.check(TokenType.Pipe)) return [];

    this.advance(); // skip opening |
    const vars: VariableNode[] = [];

    while (this.check(TokenType.Identifier)) {
      vars.push(this.makeVariable(this.advance()));
    }

    this.expect(TokenType.Pipe, "Expected '|' to close temporaries");
    return vars;
  }

  // ── Statements ────────────────────────────────────────

  private parseStatements(): StatementNode[] {
    const statements: StatementNode[] = [];

    while (!this.atEnd() && !this.check(TokenType.RightBracket) && !this.check(TokenType.RightBrace)) {
      // Handle inline pragmas
      while (this.check(TokenType.LessThan)) {
        this.parsePragma(); // consume but we don't track inline pragmas in statements
      }

      if (this.atEnd() || this.check(TokenType.RightBracket) || this.check(TokenType.RightBrace)) break;

      // Return statement
      if (this.check(TokenType.Caret)) {
        statements.push(this.parseReturn());
        // Optional period after return
        if (this.check(TokenType.Period)) this.advance();
        break; // Return is the last statement
      }

      const stmt = this.parseStatement();
      statements.push(stmt);

      // Statement separator
      if (this.check(TokenType.Period)) {
        this.advance();
      } else {
        break;
      }
    }

    return statements;
  }

  private parseReturn(): ReturnNode {
    const start = this.currentRange().start;
    this.advance(); // skip ^
    const expression = this.parseExpressionNode();
    return {
      kind: 'Return',
      expression,
      range: this.rangeFrom(start),
    };
  }

  private parseStatement(): StatementNode {
    const start = this.currentRange().start;

    // Check for assignment: identifier := or identifier _
    if (this.check(TokenType.Identifier) && this.pos + 1 < this.tokens.length) {
      const next = this.tokens[this.pos + 1];
      if (next.type === TokenType.Assign || next.type === TokenType.Underscore) {
        const variable = this.makeVariable(this.advance());
        this.advance(); // skip := or _
        const value = this.parseStatement(); // Assignments can chain
        return {
          kind: 'Assignment',
          variable,
          value,
          range: this.rangeFrom(start),
        } as AssignmentNode;
      }
    }

    return this.parseExpressionNode();
  }

  // ── Expression ────────────────────────────────────────

  private parseExpressionNode(): ExpressionNode {
    const start = this.currentRange().start;
    const receiver = this.parsePrimary();
    const messages = this.parseMessages(receiver);
    const cascades: MessageNode[] = [];

    // Parse cascades: ; message
    while (this.check(TokenType.Semicolon)) {
      this.advance(); // skip ;
      const cascadeMessages = this.parseCascadeMessage();
      if (cascadeMessages) {
        cascades.push(cascadeMessages);
      }
    }

    return {
      kind: 'Expression',
      receiver,
      messages,
      cascades,
      range: this.rangeFrom(start),
    };
  }

  private parseMessages(_receiver: PrimaryNode): MessageNode[] {
    const messages: MessageNode[] = [];

    // Unary messages (highest precedence)
    while (this.isUnaryMessage()) {
      const start = this.currentRange().start;
      let envSpecifier: string | undefined;
      if (this.check(TokenType.EnvSpecifier)) {
        envSpecifier = this.advance().text;
      }
      const selector = this.advance();
      messages.push({
        kind: 'UnaryMessage',
        selector: selector.text,
        envSpecifier,
        range: this.rangeFrom(start),
      } as UnaryMessageNode);
    }

    // Binary messages
    while (this.isBinaryMessage()) {
      const start = this.currentRange().start;
      let envSpecifier: string | undefined;
      if (this.check(TokenType.EnvSpecifier)) {
        envSpecifier = this.advance().text;
      }
      const selector = this.advance();
      const argPrimary = this.parsePrimary();
      // Parse unary messages on the argument
      const argMessages: UnaryMessageNode[] = [];
      while (this.isUnaryMessage()) {
        const uStart = this.currentRange().start;
        const uSelector = this.advance();
        argMessages.push({
          kind: 'UnaryMessage',
          selector: uSelector.text,
          range: this.rangeFrom(uStart),
        });
      }
      const argument = this.wrapWithMessages(argPrimary, argMessages, start);
      messages.push({
        kind: 'BinaryMessage',
        selector: selector.text,
        argument,
        envSpecifier,
        range: this.rangeFrom(start),
      } as BinaryMessageNode);
    }

    // Keyword message (at most one)
    if (this.isKeywordMessage()) {
      const kwMsg = this.parseKeywordMessage();
      if (kwMsg) messages.push(kwMsg);
    }

    return messages;
  }

  private parseCascadeMessage(): MessageNode | null {
    if (this.isUnaryMessage()) {
      const start = this.currentRange().start;
      const selector = this.advance();
      return {
        kind: 'UnaryMessage',
        selector: selector.text,
        range: this.rangeFrom(start),
      } as UnaryMessageNode;
    }

    if (this.isBinaryMessage()) {
      const start = this.currentRange().start;
      const selector = this.advance();
      const argPrimary = this.parsePrimary();
      const argMessages: UnaryMessageNode[] = [];
      while (this.isUnaryMessage()) {
        const uStart = this.currentRange().start;
        const uSelector = this.advance();
        argMessages.push({
          kind: 'UnaryMessage',
          selector: uSelector.text,
          range: this.rangeFrom(uStart),
        });
      }
      const argument = this.wrapWithMessages(argPrimary, argMessages, start);
      return {
        kind: 'BinaryMessage',
        selector: selector.text,
        argument,
        range: this.rangeFrom(start),
      } as BinaryMessageNode;
    }

    if (this.isKeywordMessage()) {
      return this.parseKeywordMessage();
    }

    return null;
  }

  private parseKeywordMessage(): KeywordMessageNode | null {
    if (!this.check(TokenType.Keyword)) return null;

    const start = this.currentRange().start;
    let envSpecifier: string | undefined;
    if (this.check(TokenType.EnvSpecifier)) {
      envSpecifier = this.advance().text;
    }

    const parts: KeywordPartNode[] = [];
    const keywords: string[] = [];

    while (this.check(TokenType.Keyword)) {
      const partStart = this.currentRange().start;
      const kw = this.advance();
      keywords.push(kw.text);

      const argPrimary = this.parsePrimary();
      // Parse unary then binary messages on the argument
      const argMsgs: MessageNode[] = [];
      while (this.isUnaryMessage()) {
        const uStart = this.currentRange().start;
        const uSelector = this.advance();
        argMsgs.push({
          kind: 'UnaryMessage',
          selector: uSelector.text,
          range: this.rangeFrom(uStart),
        });
      }
      while (this.isBinaryMessage()) {
        const bStart = this.currentRange().start;
        const bSelector = this.advance();
        const bArgPrimary = this.parsePrimary();
        const bArgMsgs: UnaryMessageNode[] = [];
        while (this.isUnaryMessage()) {
          const buStart = this.currentRange().start;
          const buSelector = this.advance();
          bArgMsgs.push({
            kind: 'UnaryMessage',
            selector: buSelector.text,
            range: this.rangeFrom(buStart),
          });
        }
        const bArgument = this.wrapWithMessages(bArgPrimary, bArgMsgs, bStart);
        argMsgs.push({
          kind: 'BinaryMessage',
          selector: bSelector.text,
          argument: bArgument,
          range: this.rangeFrom(bStart),
        });
      }

      const value = this.wrapWithMessages(argPrimary, argMsgs, partStart);
      parts.push({
        kind: 'KeywordPart',
        keyword: kw.text,
        value,
        range: this.rangeFrom(partStart),
      });
    }

    return {
      kind: 'KeywordMessage',
      parts,
      selector: keywords.join(''),
      envSpecifier,
      range: this.rangeFrom(start),
    };
  }

  // ── Primary ───────────────────────────────────────────

  private parsePrimary(): PrimaryNode {
    // Array literal: #(...)
    if (this.check(TokenType.HashLeftParen)) {
      return this.parseArrayLiteral();
    }

    // Byte array literal: #[...]
    if (this.check(TokenType.HashLeftBracket)) {
      return this.parseByteArrayLiteral();
    }

    // Symbol: #foo, #'bar', #+
    if (this.check(TokenType.Symbol)) {
      return this.parseSymbolLiteral();
    }

    // Hash alone (shouldn't normally appear but handle gracefully)
    if (this.check(TokenType.Hash)) {
      const start = this.currentRange().start;
      this.advance();
      this.addError("Unexpected '#'");
      return { kind: 'SymbolLiteral', value: '#', range: this.rangeFrom(start) } as SymbolLiteralNode;
    }

    // Block: [...]
    if (this.check(TokenType.LeftBracket)) {
      return this.parseBlock();
    }

    // Curly array or selection block: {...}
    if (this.check(TokenType.LeftBrace)) {
      return this.parseCurlyOrSelectionBlock();
    }

    // Paren expression: (...)
    if (this.check(TokenType.LeftParen)) {
      return this.parseParenExpression();
    }

    // Negative number: - Number
    if (this.check(TokenType.Minus)) {
      const next = this.pos + 1 < this.tokens.length ? this.tokens[this.pos + 1] : null;
      if (next && (next.type === TokenType.Integer || next.type === TokenType.Float || next.type === TokenType.ScaledDecimal)) {
        const start = this.currentRange().start;
        this.advance(); // skip -
        const num = this.advance();
        return {
          kind: 'NumberLiteral',
          value: '-' + num.text,
          range: this.rangeFrom(start),
        } as NumberLiteralNode;
      }
    }

    // Literals
    if (this.isLiteral()) {
      return this.parseLiteral();
    }

    // Identifier (possibly a path)
    if (this.check(TokenType.Identifier)) {
      return this.parseIdentifierOrPath();
    }

    // Error recovery
    const start = this.currentRange().start;
    const token = this.advance();
    this.addError(`Unexpected token '${token.text}'`);
    return {
      kind: 'Variable',
      name: token.text,
      range: this.rangeFrom(start),
    } as VariableNode;
  }

  private parseIdentifierOrPath(): PrimaryNode {
    const start = this.currentRange().start;
    const id = this.advance();

    // Check for path: identifier.identifier...
    // Only treat dot as a path separator (not a statement separator) when
    // the dot is immediately adjacent to the following token (no whitespace).
    if (this.check(TokenType.Period) && this.pos + 1 < this.tokens.length) {
      const dot = this.tokens[this.pos];
      const nextAfterDot = this.tokens[this.pos + 1];
      const dotAdjacent = id.range.end.offset === dot.range.start.offset &&
        dot.range.end.offset === nextAfterDot.range.start.offset;
      if (dotAdjacent && (nextAfterDot.type === TokenType.Identifier || nextAfterDot.type === TokenType.BinarySelector)) {
        const segments = [id.text];
        while (this.check(TokenType.Period) && this.pos + 1 < this.tokens.length) {
          const thisDot = this.tokens[this.pos];
          const afterDot = this.tokens[this.pos + 1];
          const adjacent = thisDot.range.end.offset === afterDot.range.start.offset;
          if (adjacent && (afterDot.type === TokenType.Identifier ||
              (afterDot.type === TokenType.BinarySelector && afterDot.text === '*'))) {
            this.advance(); // skip .
            segments.push(this.advance().text);
          } else {
            break;
          }
        }
        if (segments.length > 1) {
          return {
            kind: 'Path',
            segments,
            range: this.rangeFrom(start),
          } as PathNode;
        }
      }
    }

    return {
      kind: 'Variable',
      name: id.text,
      range: this.rangeFrom(start),
    } as VariableNode;
  }

  private parseBlock(): BlockNode {
    const start = this.currentRange().start;
    this.advance(); // skip [

    const parameters: VariableNode[] = [];

    // Block parameters: :param1 :param2 |
    if (this.check(TokenType.Colon)) {
      while (this.check(TokenType.Colon)) {
        this.advance(); // skip :
        const param = this.expectIdentifier('Expected block parameter name');
        parameters.push(this.makeVariable(param));
      }
      this.expect(TokenType.Pipe, "Expected '|' after block parameters");
    }

    const temporaries = this.parseTemporaries();
    const statements = this.parseStatements();

    this.expect(TokenType.RightBracket, "Expected ']' to close block");

    return {
      kind: 'Block',
      parameters,
      temporaries,
      statements,
      range: this.rangeFrom(start),
    };
  }

  private parseCurlyOrSelectionBlock(): PrimaryNode {
    const start = this.currentRange().start;

    // Look ahead for selection block pattern: { :param | predicate }
    if (this.pos + 1 < this.tokens.length && this.tokens[this.pos + 1].type === TokenType.Colon) {
      return this.parseSelectionBlock(start);
    }

    return this.parseCurlyArrayBuilder(start);
  }

  private parseSelectionBlock(start: SourcePosition): SelectionBlockNode {
    this.advance(); // skip {
    this.advance(); // skip :
    const param = this.expectIdentifier('Expected selection block parameter');
    this.expect(TokenType.Pipe, "Expected '|' after selection block parameter");
    const predicate = this.parseExpressionNode();
    this.expect(TokenType.RightBrace, "Expected '}' to close selection block");

    return {
      kind: 'SelectionBlock',
      parameter: this.makeVariable(param),
      predicate,
      range: this.rangeFrom(start),
    };
  }

  private parseCurlyArrayBuilder(start: SourcePosition): CurlyArrayBuilderNode {
    this.advance(); // skip {
    const expressions: ExpressionNode[] = [];

    if (!this.check(TokenType.RightBrace)) {
      expressions.push(this.parseExpressionNode());
      while (this.check(TokenType.Period)) {
        this.advance(); // skip .
        if (this.check(TokenType.RightBrace)) break;
        expressions.push(this.parseExpressionNode());
      }
    }

    this.expect(TokenType.RightBrace, "Expected '}' to close curly array");

    return {
      kind: 'CurlyArrayBuilder',
      expressions,
      range: this.rangeFrom(start),
    };
  }

  private parseParenExpression(): ParenExpressionNode {
    const start = this.currentRange().start;
    this.advance(); // skip (
    const expression = this.parseStatement();
    this.expect(TokenType.RightParen, "Expected ')' to close parenthesized expression");

    return {
      kind: 'ParenExpression',
      expression,
      range: this.rangeFrom(start),
    };
  }

  private parseArrayLiteral(): ArrayLiteralNode {
    const start = this.currentRange().start;
    this.advance(); // skip #(
    const items: ArrayItemNode[] = [];

    while (!this.check(TokenType.RightParen) && !this.atEnd()) {
      items.push(this.parseArrayItem());
    }

    this.expect(TokenType.RightParen, "Expected ')' to close array literal");

    return {
      kind: 'ArrayLiteral',
      items,
      range: this.rangeFrom(start),
    };
  }

  private parseArrayItem(): ArrayItemNode {
    if (this.check(TokenType.HashLeftParen)) {
      return this.parseArrayLiteral();
    }

    if (this.check(TokenType.HashLeftBracket)) {
      return this.parseByteArrayLiteral();
    }

    if (this.check(TokenType.Minus)) {
      const next = this.pos + 1 < this.tokens.length ? this.tokens[this.pos + 1] : null;
      if (next && (next.type === TokenType.Integer || next.type === TokenType.Float)) {
        const start = this.currentRange().start;
        this.advance();
        const num = this.advance();
        return {
          kind: 'NumberLiteral',
          value: '-' + num.text,
          range: this.rangeFrom(start),
        } as NumberLiteralNode;
      }
    }

    // Inside #(), bare identifiers and keywords are treated as symbols
    if (this.check(TokenType.Identifier)) {
      const start = this.currentRange().start;
      let text = this.advance().text;
      // Check for keyword symbol inside array: foo:bar:
      while (this.check(TokenType.Keyword)) {
        text += this.advance().text;
      }
      return {
        kind: 'SymbolLiteral',
        value: text,
        range: this.rangeFrom(start),
      } as SymbolLiteralNode;
    }

    if (this.check(TokenType.Keyword)) {
      const start = this.currentRange().start;
      let text = '';
      while (this.check(TokenType.Keyword)) {
        text += this.advance().text;
      }
      return {
        kind: 'SymbolLiteral',
        value: text,
        range: this.rangeFrom(start),
      } as SymbolLiteralNode;
    }

    return this.parseLiteral() as ArrayItemNode;
  }

  private parseByteArrayLiteral(): ByteArrayLiteralNode {
    const start = this.currentRange().start;
    this.advance(); // skip #[
    const values: NumberLiteralNode[] = [];

    while (!this.check(TokenType.RightBracket) && !this.atEnd()) {
      if (this.check(TokenType.Integer) || this.check(TokenType.Float)) {
        const numStart = this.currentRange().start;
        const num = this.advance();
        values.push({
          kind: 'NumberLiteral',
          value: num.text,
          range: this.rangeFrom(numStart),
        });
      } else {
        this.addError('Expected number in byte array literal');
        this.advance(); // skip bad token
      }
    }

    this.expect(TokenType.RightBracket, "Expected ']' to close byte array literal");

    return {
      kind: 'ByteArrayLiteral',
      values,
      range: this.rangeFrom(start),
    };
  }

  private parseSymbolLiteral(): SymbolLiteralNode {
    const start = this.currentRange().start;
    const token = this.advance();
    return {
      kind: 'SymbolLiteral',
      value: token.text.startsWith('#') ? token.text.slice(1) : token.text,
      range: this.rangeFrom(start),
    };
  }

  // ── Literals ──────────────────────────────────────────

  private parseLiteral(): LiteralNode {
    const start = this.currentRange().start;
    const token = this.peek();

    switch (token.type) {
      case TokenType.Integer:
      case TokenType.Float:
      case TokenType.ScaledDecimal:
        this.advance();
        return {
          kind: 'NumberLiteral',
          value: token.text,
          range: this.rangeFrom(start),
        } as NumberLiteralNode;

      case TokenType.String:
        this.advance();
        return {
          kind: 'StringLiteral',
          value: token.text,
          range: this.rangeFrom(start),
        } as StringLiteralNode;

      case TokenType.Symbol:
        return this.parseSymbolLiteral();

      case TokenType.Character:
        this.advance();
        return {
          kind: 'CharacterLiteral',
          value: token.text,
          range: this.rangeFrom(start),
        } as CharacterLiteralNode;

      case TokenType.SpecialLiteral:
        this.advance();
        return {
          kind: 'SpecialLiteral',
          value: token.text as 'true' | 'false' | 'nil' | '_remoteNil',
          range: this.rangeFrom(start),
        } as SpecialLiteralNode;

      case TokenType.HashLeftParen:
        return this.parseArrayLiteral();

      case TokenType.HashLeftBracket:
        return this.parseByteArrayLiteral();

      default:
        this.advance();
        this.addError(`Expected literal, got '${token.text}'`);
        return {
          kind: 'NumberLiteral',
          value: '0',
          range: this.rangeFrom(start),
        } as NumberLiteralNode;
    }
  }

  // ── Helpers ───────────────────────────────────────────

  private isUnaryMessage(): boolean {
    if (this.atEnd()) return false;
    const token = this.peek();
    // Unary message is an identifier that is NOT followed by ':'
    // (that would make it a keyword) and is not a special literal
    if (token.type === TokenType.EnvSpecifier) {
      // env specifier followed by identifier
      const next = this.pos + 1 < this.tokens.length ? this.tokens[this.pos + 1] : null;
      return next !== null && next.type === TokenType.Identifier;
    }
    if (token.type !== TokenType.Identifier) return false;
    if (token.text === 'true' || token.text === 'false' || token.text === 'nil' || token.text === '_remoteNil') return false;
    return true;
  }

  private isBinaryMessage(): boolean {
    if (this.atEnd()) return false;
    const token = this.peek();
    if (token.type === TokenType.EnvSpecifier) {
      const next = this.pos + 1 < this.tokens.length ? this.tokens[this.pos + 1] : null;
      return next !== null && (next.type === TokenType.BinarySelector || next.type === TokenType.Minus ||
        next.type === TokenType.LessThan || next.type === TokenType.GreaterThan);
    }
    return token.type === TokenType.BinarySelector || token.type === TokenType.Minus ||
      token.type === TokenType.LessThan || token.type === TokenType.GreaterThan;
  }

  private isKeywordMessage(): boolean {
    if (this.atEnd()) return false;
    const token = this.peek();
    if (token.type === TokenType.EnvSpecifier) {
      const next = this.pos + 1 < this.tokens.length ? this.tokens[this.pos + 1] : null;
      return next !== null && next.type === TokenType.Keyword;
    }
    return token.type === TokenType.Keyword;
  }

  private isLiteral(): boolean {
    if (this.atEnd()) return false;
    const t = this.peek().type;
    return (
      t === TokenType.Integer ||
      t === TokenType.Float ||
      t === TokenType.ScaledDecimal ||
      t === TokenType.String ||
      t === TokenType.Symbol ||
      t === TokenType.Character ||
      t === TokenType.SpecialLiteral ||
      t === TokenType.HashLeftParen ||
      t === TokenType.HashLeftBracket
    );
  }

  private wrapWithMessages(primary: PrimaryNode, messages: MessageNode[], start: SourcePosition): ExpressionNode {
    return {
      kind: 'Expression',
      receiver: primary,
      messages,
      cascades: [],
      range: this.rangeFrom(start),
    };
  }

  private makeVariable(token: Token): VariableNode {
    return {
      kind: 'Variable',
      name: token.text,
      range: token.range,
    };
  }

  // ── Token Stream ──────────────────────────────────────

  private peek(): Token {
    if (this.pos >= this.tokens.length) {
      const lastPos = this.tokens.length > 0
        ? this.tokens[this.tokens.length - 1].range.end
        : createPosition(0, 0, 0);
      return { type: TokenType.EOF, text: '', range: createRange(lastPos, lastPos) };
    }
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.peek();
    if (this.pos < this.tokens.length) this.pos++;
    return token;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    this.addError(message);
    return this.peek();
  }

  private expectIdentifier(message: string): Token {
    if (this.check(TokenType.Identifier)) {
      return this.advance();
    }
    this.addError(message);
    // Return a synthetic token
    const pos = this.currentRange().start;
    return {
      type: TokenType.Identifier,
      text: 'unknown',
      range: createRange(pos, pos),
    };
  }

  private atEnd(): boolean {
    return this.pos >= this.tokens.length || this.peek().type === TokenType.EOF;
  }

  private currentRange(): SourceRange {
    return this.peek().range;
  }

  private rangeFrom(start: SourcePosition): SourceRange {
    const end = this.pos > 0 ? this.tokens[this.pos - 1].range.end : start;
    return createRange(start, end);
  }

  private addError(message: string): void {
    this.errors.addError(message, this.currentRange());
  }
}
