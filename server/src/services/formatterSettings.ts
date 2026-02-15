export interface FormatterSettings {
  /** Number of spaces per indent level. Default: 2 */
  tabSize: number;

  /** Use spaces (true) or tabs (false) for indentation. Default: true */
  insertSpaces: boolean;

  /** Add spaces inside parentheses: ( x ) vs (x). Default: false */
  spacesInsideParens: boolean;

  /** Add spaces inside brackets: [ x ] vs [x]. Default: false */
  spacesInsideBrackets: boolean;

  /** Add spaces inside braces: { x } vs {x}. Default: false */
  spacesInsideBraces: boolean;

  /** Add spaces around assignment operator: x := y vs x:=y. Default: true */
  spacesAroundAssignment: boolean;

  /** Add spaces around binary selectors: a + b vs a+b. Default: true */
  spacesAroundBinarySelectors: boolean;

  /** Add space after return caret: ^ x vs ^x. Default: false */
  spaceAfterCaret: boolean;

  /** Insert blank line between method pattern and body. Default: true */
  blankLineAfterMethodPattern: boolean;

  /** Maximum line length before wrapping (0 = no wrapping). Default: 0 */
  maxLineLength: number;

  /** Indentation width for continuation lines (multi-keyword messages). Default: 2 */
  continuationIndent: number;

  /** Split keyword messages to multiple lines when keyword count >= this. Default: 2 */
  multiKeywordThreshold: number;

  /** Remove unnecessary parentheses based on Smalltalk precedence rules. Default: true */
  removeUnnecessaryParens: boolean;
}

export const DEFAULT_SETTINGS: FormatterSettings = {
  tabSize: 2,
  insertSpaces: true,
  spacesInsideParens: false,
  spacesInsideBrackets: false,
  spacesInsideBraces: false,
  spacesAroundAssignment: true,
  spacesAroundBinarySelectors: true,
  spaceAfterCaret: false,
  blankLineAfterMethodPattern: true,
  maxLineLength: 0,
  continuationIndent: 2,
  multiKeywordThreshold: 2,
  removeUnnecessaryParens: true,
};
