export enum TokenType {
  // Literals
  Integer,
  Float,
  ScaledDecimal,
  String,
  Symbol,
  Character,
  SpecialLiteral,

  // Identifiers & Keywords
  Identifier,
  Keyword,

  // Operators & Selectors
  BinarySelector,

  // Delimiters
  LeftParen,
  RightParen,
  LeftBracket,
  RightBracket,
  LeftBrace,
  RightBrace,
  Hash,
  HashLeftBracket,
  HashLeftParen,

  // Punctuation
  Period,
  Semicolon,
  Colon,
  Caret,
  Assign,
  Underscore,
  Pipe,
  Ampersand,

  // Special
  LessThan,
  GreaterThan,
  EnvSpecifier,
  Minus,

  // Meta
  Comment,
  Whitespace,
  EOF,
  Error,
}

export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface Token {
  type: TokenType;
  text: string;
  range: SourceRange;
}

export function createPosition(offset: number, line: number, column: number): SourcePosition {
  return { offset, line, column };
}

export function createRange(start: SourcePosition, end: SourcePosition): SourceRange {
  return { start, end };
}
