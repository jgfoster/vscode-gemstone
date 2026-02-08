import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from './utils/documentManager';
import { toDiagnostics } from './services/diagnostics';
import { getDocumentSymbols } from './services/documentSymbols';
import { getCompletions } from './services/completion';
import { getHover } from './services/hover';
import { getDefinition } from './services/definition';
import { getFoldingRanges } from './services/folding';
import { formatDocument } from './services/formatting';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const documentManager = new DocumentManager();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        triggerCharacters: [':', '.', '#', '$', '@'],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
    },
  };
});

// ── Document Lifecycle ──────────────────────────────────

documents.onDidChangeContent((change) => {
  const parsed = documentManager.update(
    change.document.uri,
    change.document.version,
    change.document.getText()
  );
  connection.sendDiagnostics({
    uri: parsed.uri,
    diagnostics: toDiagnostics(parsed.errors),
  });
});

documents.onDidClose((event) => {
  documentManager.remove(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ── Completion ──────────────────────────────────────────

connection.onCompletion((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];
  return getCompletions(doc, params.position);
});

// ── Hover ───────────────────────────────────────────────

connection.onHover((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return null;
  return getHover(doc, params.position);
});

// ── Go to Definition ────────────────────────────────────

connection.onDefinition((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return null;
  return getDefinition(doc, params.position);
});

// ── Document Symbols ────────────────────────────────────

connection.onDocumentSymbol((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc || !doc.ast) return [];
  return getDocumentSymbols(doc.ast);
});

// ── Folding Ranges ──────────────────────────────────────

connection.onFoldingRanges((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];
  return getFoldingRanges(doc);
});

// ── Formatting ──────────────────────────────────────────

connection.onDocumentFormatting((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];
  return formatDocument(doc.tokens, params.options.tabSize);
});

// ── Start ───────────────────────────────────────────────

documents.listen(connection);
connection.listen();
