import { Hover, Position, MarkupKind } from 'vscode-languageserver';
import { ParsedDocument } from '../utils/documentManager';
import { ScopeAnalyzer } from '../utils/scopeAnalyzer';
import { Token, TokenType, createPosition } from '../lexer/tokens';

const PSEUDO_VARIABLE_DOCS: Record<string, string> = {
  self: '**self** — The receiver of the current message',
  super: '**super** — The receiver, using superclass method lookup',
  thisContext: '**thisContext** — The current execution context (GsProcess)',
};

const SPECIAL_LITERAL_DOCS: Record<string, string> = {
  true: '**true** — The Boolean true object',
  false: '**false** — The Boolean false object',
  nil: '**nil** — The undefined object (UndefinedObject)',
  _remoteNil: '**_remoteNil** — Remote nil marker',
};

export function getHover(doc: ParsedDocument, position: Position): Hover | null {
  const token = findTokenAt(doc.tokens, position);
  if (!token) return null;

  // Pseudo-variables
  if (token.type === TokenType.Identifier) {
    const pvDoc = PSEUDO_VARIABLE_DOCS[token.text];
    if (pvDoc) {
      return {
        contents: { kind: MarkupKind.Markdown, value: pvDoc },
      };
    }
  }

  // Special literals
  if (token.type === TokenType.SpecialLiteral) {
    const slDoc = SPECIAL_LITERAL_DOCS[token.text];
    if (slDoc) {
      return {
        contents: { kind: MarkupKind.Markdown, value: slDoc },
      };
    }
  }

  // Variables in scope
  if (token.type === TokenType.Identifier && doc.ast) {
    const analyzer = new ScopeAnalyzer();
    const root = analyzer.analyze(doc.ast);
    const pos = createPosition(0, position.line, position.character);
    const varInfo = analyzer.findVariableAt(root, token.text, pos);
    if (varInfo) {
      const kindLabel = varInfo.kind.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${token.text}** — ${kindLabel} (line ${varInfo.definitionRange.start.line + 1})`,
        },
      };
    }
  }

  // Keyword tokens - show the selector
  if (token.type === TokenType.Keyword) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${token.text}** — keyword selector`,
      },
    };
  }

  // Numbers - show interpretation
  if (token.type === TokenType.Integer || token.type === TokenType.Float || token.type === TokenType.ScaledDecimal) {
    const interpretation = interpretNumber(token.text);
    if (interpretation) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${token.text}** — ${interpretation}`,
        },
      };
    }
  }

  // Symbols
  if (token.type === TokenType.Symbol) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${token.text}** — Symbol`,
      },
    };
  }

  // Env specifier
  if (token.type === TokenType.EnvSpecifier) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${token.text}** — Environment specifier`,
      },
    };
  }

  return null;
}

function findTokenAt(tokens: Token[], position: Position): Token | null {
  for (const token of tokens) {
    if (token.type === TokenType.Whitespace || token.type === TokenType.EOF) continue;
    const r = token.range;
    if (position.line >= r.start.line && position.line <= r.end.line) {
      if (position.line === r.start.line && position.character < r.start.column) continue;
      if (position.line === r.end.line && position.character >= r.end.column) continue;
      return token;
    }
  }
  return null;
}

function interpretNumber(text: string): string | null {
  // Radixed literal
  const radixMatch = text.match(/^(\d+)[rR#]([0-9A-Za-z]+)$/);
  if (radixMatch) {
    const radix = parseInt(radixMatch[1], 10);
    const value = parseInt(radixMatch[2], radix);
    if (!isNaN(value)) {
      return `${value} (base ${radix})`;
    }
  }

  // Scaled decimal
  if (text.includes('s')) {
    return 'ScaledDecimal';
  }

  return null;
}
