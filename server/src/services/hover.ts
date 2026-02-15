import { Hover, Position, MarkupKind } from 'vscode-languageserver';
import { ParsedDocument, ParsedRegion } from '../utils/documentManager';
import { ScopeAnalyzer } from '../utils/scopeAnalyzer';
import { TokenType, createPosition, SourceRange } from '../lexer/tokens';
import { findTokenAt, findKeywordSelector, isVariableInAST } from '../utils/astUtils';

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

export function getHover(doc: ParsedDocument, position: Position, region?: ParsedRegion): Hover | null {
  const tokens = region?.tokens ?? doc.tokens;
  const token = findTokenAt(tokens, position);
  if (!token) return null;

  const ast = region?.ast ?? doc.ast;

  // Token/position lines are document-level; AST lines are region-relative.
  // For smalltalk-code regions, the AST has a dummy '_doIt' line prepended (+1).
  const lineOffset = region
    ? region.region.startLine - (region.region.kind === 'smalltalk-code' ? 1 : 0)
    : 0;

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
  if (token.type === TokenType.Identifier && ast) {
    const analyzer = new ScopeAnalyzer();
    const root = analyzer.analyze(ast);
    const pos = createPosition(0, position.line - lineOffset, position.character);
    const varInfo = analyzer.findVariableAt(root, token.text, pos);
    if (varInfo) {
      const kindLabel = varInfo.kind.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      const docLine = varInfo.definitionRange.start.line + lineOffset + 1;
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `\`${token.text}\` — ${kindLabel} (line ${docLine})`,
        },
      };
    }

    // Not in method scope — check AST to distinguish variable from unary selector
    const varAstRange: SourceRange = {
      start: { ...token.range.start, line: token.range.start.line - lineOffset },
      end: { ...token.range.end, line: token.range.end.line - lineOffset },
    };
    if (isVariableInAST(ast, varAstRange)) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `\`${token.text}\` — variable`,
        },
      };
    }
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `\`${token.text}\` — unary selector`,
      },
    };
  }

  // Keyword tokens - show the full composed selector from AST
  if (token.type === TokenType.Keyword && ast) {
    const astRange: SourceRange = {
      start: { ...token.range.start, line: token.range.start.line - lineOffset },
      end: { ...token.range.end, line: token.range.end.line - lineOffset },
    };
    const fullSelector = findKeywordSelector(ast, astRange);
    const label = fullSelector ?? token.text;
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `\`${label}\` — keyword selector`,
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
        value: `\`${token.text}\` — Symbol`,
      },
    };
  }

  // Characters
  if (token.type === TokenType.Character) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `\`${token.text}\` — Character`,
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
