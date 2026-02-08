import { Location, Position } from 'vscode-languageserver';
import { ParsedDocument } from '../utils/documentManager';
import { ScopeAnalyzer } from '../utils/scopeAnalyzer';
import { Token, TokenType, createPosition } from '../lexer/tokens';

export function getDefinition(doc: ParsedDocument, position: Position): Location | null {
  if (!doc.ast) return null;

  // Find the token at the cursor
  const token = findIdentifierAt(doc.tokens, position);
  if (!token) return null;

  const analyzer = new ScopeAnalyzer();
  const root = analyzer.analyze(doc.ast);
  const pos = createPosition(0, position.line, position.character);
  const varInfo = analyzer.findVariableAt(root, token.text, pos);

  if (!varInfo) return null;

  return {
    uri: doc.uri,
    range: {
      start: {
        line: varInfo.definitionRange.start.line,
        character: varInfo.definitionRange.start.column,
      },
      end: {
        line: varInfo.definitionRange.end.line,
        character: varInfo.definitionRange.end.column,
      },
    },
  };
}

function findIdentifierAt(tokens: Token[], position: Position): Token | null {
  for (const token of tokens) {
    if (token.type !== TokenType.Identifier) continue;
    const r = token.range;
    if (position.line >= r.start.line && position.line <= r.end.line) {
      if (position.line === r.start.line && position.character < r.start.column) continue;
      if (position.line === r.end.line && position.character >= r.end.column) continue;
      return token;
    }
  }
  return null;
}
