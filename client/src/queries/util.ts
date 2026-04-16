export function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

export function receiver(className: string, isMeta: boolean): string {
  return isMeta ? `${className} class` : className;
}

export function splitLines(result: string): string[] {
  return result.split('\n').filter(s => s.length > 0);
}

export function compiledMethodExpr(
  className: string, isMeta: boolean, selector: string, environmentId: number,
): string {
  return `(${receiver(className, isMeta)} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId})`;
}

// Compose a Smalltalk expression that resolves a class by name, optionally
// scoped to a specific dictionary (by 1-based index or by name). Evaluates to
// the class OOP, or nil if not found. Callers should `ifNil:` to handle the
// missing case.
//
// Why "optionally scoped": a user's symbolList is an ordered list of
// SymbolDictionaries; `objectNamed:` returns the first match and shadows
// later entries with the same name. When a caller knows which dictionary it
// wants (e.g. Jasper's class browser walking a tree), dict-scoped lookup
// hits the specific class even when shadowed.
export function classLookupExpr(className: string, dict?: number | string): string {
  const esc = escapeString(className);
  if (dict === undefined) {
    return `System myUserProfile symbolList objectNamed: #'${esc}'`;
  }
  if (typeof dict === 'number') {
    return `(System myUserProfile symbolList at: ${dict}) at: #'${esc}' ifAbsent: [nil]`;
  }
  return `(System myUserProfile symbolList objectNamed: #'${escapeString(dict)}') ifNotNil: [:d | d at: #'${esc}' ifAbsent: [nil]]`;
}
