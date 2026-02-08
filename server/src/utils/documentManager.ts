import { Token } from '../lexer/tokens';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import { ParseError } from '../parser/errors';
import { MethodNode } from '../parser/ast';

export interface ParsedDocument {
  uri: string;
  version: number;
  text: string;
  tokens: Token[];
  ast: MethodNode | null;
  errors: ParseError[];
}

export class DocumentManager {
  private documents: Map<string, ParsedDocument> = new Map();

  update(uri: string, version: number, text: string): ParsedDocument {
    const lexer = new Lexer(text);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const { ast, errors } = parser.parse();

    const doc: ParsedDocument = {
      uri,
      version,
      text,
      tokens,
      ast,
      errors,
    };

    this.documents.set(uri, doc);
    return doc;
  }

  get(uri: string): ParsedDocument | undefined {
    return this.documents.get(uri);
  }

  remove(uri: string): void {
    this.documents.delete(uri);
  }
}
