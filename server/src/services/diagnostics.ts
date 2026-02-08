import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { ParseError } from '../parser/errors';

export function toDiagnostics(errors: ParseError[]): Diagnostic[] {
  return errors.map((error) => ({
    severity:
      error.severity === 'error'
        ? DiagnosticSeverity.Error
        : DiagnosticSeverity.Warning,
    range: {
      start: {
        line: error.range.start.line,
        character: error.range.start.column,
      },
      end: {
        line: error.range.end.line,
        character: error.range.end.column,
      },
    },
    message: error.message,
    source: 'gemstone-smalltalk',
  }));
}
