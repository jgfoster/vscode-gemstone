import { SourceRange } from '../lexer/tokens';

export interface ParseError {
  message: string;
  range: SourceRange;
  severity: 'error' | 'warning';
}

export class ParseErrorCollector {
  errors: ParseError[] = [];

  addError(message: string, range: SourceRange): void {
    this.errors.push({ message, range, severity: 'error' });
  }

  addWarning(message: string, range: SourceRange): void {
    this.errors.push({ message, range, severity: 'warning' });
  }

  hasErrors(): boolean {
    return this.errors.some((e) => e.severity === 'error');
  }
}
