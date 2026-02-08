import {
  CompletionItem,
  CompletionItemKind,
  Position,
} from 'vscode-languageserver';
import { ParsedDocument, ParsedRegion } from '../utils/documentManager';
import { ScopeAnalyzer } from '../utils/scopeAnalyzer';
import { createPosition } from '../lexer/tokens';

const PSEUDO_VARIABLES = [
  { label: 'self', detail: 'The receiver of this message' },
  { label: 'super', detail: 'The receiver, using superclass method lookup' },
  { label: 'thisContext', detail: 'The current execution context' },
];

const COMMON_SELECTORS = [
  // Control flow
  'ifTrue:', 'ifFalse:', 'ifTrue:ifFalse:', 'ifFalse:ifTrue:',
  'ifNil:', 'ifNotNil:', 'ifNil:ifNotNil:', 'ifNotNil:ifNil:',
  'whileTrue:', 'whileFalse:', 'whileTrue', 'whileFalse',
  'repeat',
  // Collection
  'do:', 'collect:', 'select:', 'reject:', 'detect:', 'detect:ifNone:',
  'inject:into:', 'with:collect:',
  'add:', 'addAll:', 'remove:', 'remove:ifAbsent:',
  'includes:', 'size', 'isEmpty', 'notEmpty',
  'at:', 'at:put:', 'at:ifAbsent:',
  'first', 'last', 'reversed',
  // Comparison
  '=', '~=', '==', '~~', '<', '>', '<=', '>=',
  'hash', 'identityHash',
  // Conversion
  'asString', 'printString', 'asArray', 'asOrderedCollection',
  'asInteger', 'asFloat',
  // Object
  'class', 'isKindOf:', 'respondsTo:', 'perform:', 'perform:with:',
  'yourself', 'copy', 'deepCopy',
  'printOn:', 'printString',
  // Testing
  'isNil', 'notNil', 'isString', 'isInteger', 'isBlock',
  // Creation
  'new', 'new:', 'with:', 'with:with:', 'with:with:with:',
  // Stream
  'next', 'nextPut:', 'nextPutAll:', 'contents', 'upToEnd',
  // Error
  'error:', 'signal', 'signal:', 'on:do:',
  // GemStone specific
  'commit', 'abort', 'beginTransaction',
  'instVarAt:', 'instVarAt:put:',
];

const PRAGMA_KEYWORDS = [
  'primitive:', 'protected', 'unprotected',
];

export function getCompletions(doc: ParsedDocument, position: Position, region?: ParsedRegion): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Use the region's AST if available, otherwise fall back to doc.ast
  const ast = region?.ast ?? doc.ast;

  // Variables in scope (from AST)
  if (ast) {
    const analyzer = new ScopeAnalyzer();
    const root = analyzer.analyze(ast);
    const pos = createPosition(0, position.line, position.character);
    const visibleVars = analyzer.allVisibleVariables(root, pos);

    for (const v of visibleVars) {
      items.push({
        label: v.name,
        kind: CompletionItemKind.Variable,
        detail: v.kind,
      });
    }
  }

  // Pseudo-variables
  for (const pv of PSEUDO_VARIABLES) {
    items.push({
      label: pv.label,
      kind: CompletionItemKind.Keyword,
      detail: pv.detail,
    });
  }

  // Constants
  items.push(
    { label: 'true', kind: CompletionItemKind.Constant, detail: 'Boolean true' },
    { label: 'false', kind: CompletionItemKind.Constant, detail: 'Boolean false' },
    { label: 'nil', kind: CompletionItemKind.Constant, detail: 'The undefined object' },
  );

  // Common selectors
  for (const sel of COMMON_SELECTORS) {
    items.push({
      label: sel,
      kind: CompletionItemKind.Method,
    });
  }

  return items;
}

export function getPragmaCompletions(): CompletionItem[] {
  return PRAGMA_KEYWORDS.map((kw) => ({
    label: kw,
    kind: CompletionItemKind.Keyword,
    detail: 'pragma keyword',
  }));
}
