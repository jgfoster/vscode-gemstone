import { TextEdit, Range } from 'vscode-languageserver';
import { Token, TokenType } from '../lexer/tokens';

export function formatDocument(tokens: Token[], tabSize: number = 2): TextEdit[] {
  const edits: TextEdit[] = [];
  const filtered = tokens.filter((t) => t.type !== TokenType.EOF);
  if (filtered.length === 0) return edits;

  let indentLevel = 0;
  const output: string[] = [];
  let lineTokens: Token[] = [];
  let currentLine = 0;

  // Group tokens by line
  const lines: Token[][] = [[]];
  for (const token of filtered) {
    if (token.type === TokenType.Whitespace) {
      // Check for newlines in whitespace
      const nlCount = (token.text.match(/\n/g) || []).length;
      for (let i = 0; i < nlCount; i++) {
        lines.push([]);
      }
      continue;
    }
    if (lines.length === 0) lines.push([]);
    lines[lines.length - 1].push(token);
  }

  // Reconstruct each line with proper indentation and spacing
  const resultLines: string[] = [];
  indentLevel = 0;

  for (const lineTokens of lines) {
    if (lineTokens.length === 0) {
      resultLines.push('');
      continue;
    }

    // Check if line starts with a closer - decrease indent before
    const firstType = lineTokens[0].type;
    if (firstType === TokenType.RightBracket || firstType === TokenType.RightBrace || firstType === TokenType.RightParen) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indent = ' '.repeat(indentLevel * tabSize);
    const parts: string[] = [indent];

    for (let i = 0; i < lineTokens.length; i++) {
      const token = lineTokens[i];
      const prev = i > 0 ? lineTokens[i - 1] : null;

      // Determine spacing
      if (i > 0) {
        const space = spaceBetween(prev!, token);
        parts.push(space);
      }

      parts.push(token.text);
    }

    resultLines.push(parts.join(''));

    // Adjust indent for next line
    for (const token of lineTokens) {
      if (token.type === TokenType.LeftBracket || token.type === TokenType.LeftBrace) {
        indentLevel++;
      } else if (token.type === TokenType.RightBracket || token.type === TokenType.RightBrace) {
        // Already decremented above if it was first on line
        if (token !== lineTokens[0]) {
          // Closer in middle of line - still need to track
          indentLevel = Math.max(0, indentLevel - 1);
        }
      }
    }
  }

  // Create a single edit replacing the entire document
  const lastToken = filtered[filtered.length - 1];
  const fullRange: Range = {
    start: { line: 0, character: 0 },
    end: {
      line: lastToken.range.end.line,
      character: lastToken.range.end.column,
    },
  };

  const newText = resultLines.join('\n');

  // Only produce edit if text changed
  const originalText = tokens
    .filter((t) => t.type !== TokenType.EOF)
    .map((t) => t.text)
    .join('');

  if (newText !== originalText) {
    edits.push({ range: fullRange, newText });
  }

  return edits;
}

function spaceBetween(prev: Token, current: Token): string {
  // No space after opening delimiters
  if (prev.type === TokenType.LeftParen || prev.type === TokenType.LeftBracket ||
      prev.type === TokenType.LeftBrace || prev.type === TokenType.HashLeftParen ||
      prev.type === TokenType.HashLeftBracket) {
    return '';
  }

  // No space before closing delimiters
  if (current.type === TokenType.RightParen || current.type === TokenType.RightBracket ||
      current.type === TokenType.RightBrace) {
    return '';
  }

  // No space before period or semicolon
  if (current.type === TokenType.Period || current.type === TokenType.Semicolon) {
    return '';
  }

  // Space around assignment
  if (prev.type === TokenType.Assign || current.type === TokenType.Assign) {
    return ' ';
  }

  // Space around binary selectors
  if (prev.type === TokenType.BinarySelector || prev.type === TokenType.Minus) {
    return ' ';
  }
  if (current.type === TokenType.BinarySelector || current.type === TokenType.Minus) {
    return ' ';
  }

  // Space after keyword
  if (prev.type === TokenType.Keyword) {
    return ' ';
  }

  // Space between identifiers/literals
  if (isValueToken(prev) && isValueToken(current)) {
    return ' ';
  }

  // Space after caret
  if (prev.type === TokenType.Caret) {
    return ' ';
  }

  // Space between pipe and identifier
  if (prev.type === TokenType.Pipe && current.type === TokenType.Identifier) {
    return ' ';
  }
  if (prev.type === TokenType.Identifier && current.type === TokenType.Pipe) {
    return ' ';
  }

  // Space after colon for block params
  if (prev.type === TokenType.Colon) {
    return '';
  }

  // Default: single space
  return ' ';
}

function isValueToken(token: Token): boolean {
  return (
    token.type === TokenType.Identifier ||
    token.type === TokenType.Integer ||
    token.type === TokenType.Float ||
    token.type === TokenType.ScaledDecimal ||
    token.type === TokenType.String ||
    token.type === TokenType.Symbol ||
    token.type === TokenType.Character ||
    token.type === TokenType.SpecialLiteral
  );
}
