import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { mcpErrorMap, applyErrorMapToShape } from '../mcpZodErrorMap';

// These tests exercise the pure error-map function and the shape-attachment
// helper, not the SDK wrapper. Format guarantees here are what the MCP SDK
// forwards verbatim to the agent over JSON-RPC; integration coverage that
// the wrapper actually flows through the SDK lives in
// mcpSocketServerIntegration.test.ts.

function parseAndGet(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input, { error: mcpErrorMap });
  if (result.success) throw new Error('expected parse to fail');
  return result.error.issues[0];
}

describe('mcpErrorMap', () => {
  describe('missing required parameter', () => {
    it('names the field and the expected type', () => {
      const schema = z.object({ isMeta: z.boolean() });
      const issue = parseAndGet(schema, {});

      expect(issue.message).toContain("Missing required parameter 'isMeta'");
      expect(issue.message).toContain('expected boolean');
    });

    it('uses dot notation for nested paths', () => {
      const schema = z.object({ outer: z.object({ inner: z.string() }) });
      const issue = parseAndGet(schema, { outer: {} });

      expect(issue.message).toContain("Missing required parameter 'outer.inner'");
      expect(issue.message).toContain('expected string');
    });
  });

  describe('wrong type', () => {
    // Common LLM mistake: passing a string "false" instead of a boolean.
    // Default zod text says "expected boolean, received string" without the
    // field name. We want the field name front and center.
    it('names the field, the expected type, and what was received', () => {
      const schema = z.object({ isMeta: z.boolean() });
      const issue = parseAndGet(schema, { isMeta: 'false' });

      expect(issue.message).toContain("Parameter 'isMeta'");
      expect(issue.message).toContain('must be boolean');
      expect(issue.message).toContain('received string');
    });

    it('reports null and arrays as their own kinds (not "object")', () => {
      const schema = z.object({ x: z.string() });

      const nullIssue = parseAndGet(schema, { x: null });
      expect(nullIssue.message).toContain('received null');

      const arrayIssue = parseAndGet(schema, { x: [1, 2, 3] });
      expect(arrayIssue.message).toContain('received array');
    });
  });

  describe('codes we do not specialize', () => {
    // Returning undefined falls through to zod's default formatter — we don't
    // want to accidentally regress messages we don't understand fully.
    it('falls through to the default formatter for too_small and similar', () => {
      const schema = z.object({ name: z.string().min(3) });
      const issue = parseAndGet(schema, { name: 'a' });

      // Zod's default text for too_small contains "at least" or similar; the
      // exact wording varies by version, so we just assert we did *not*
      // overwrite it with our parameter-shape template.
      expect(issue.message).not.toContain('Missing required parameter');
      expect(issue.message).not.toContain('Parameter ');
    });
  });
});

describe('applyErrorMapToShape', () => {
  // The whole point of attaching per-schema is that downstream parses pick
  // up the message *without* the caller passing { error } each time —
  // because the SDK builds its own ZodObject from our shape and parses with
  // no override.
  it('attaches the MCP error map to each field so default safeParse picks it up', () => {
    const shape = {
      isMeta: z.boolean(),
      selector: z.string(),
    };
    applyErrorMapToShape(shape);

    // No `{ error: ... }` arg here — the message must come from the field.
    const objSchema = z.object(shape);
    const result = objSchema.safeParse({ isMeta: 'false' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const isMetaIssue = result.error.issues.find(i => i.path[0] === 'isMeta')!;
    expect(isMetaIssue.message).toContain("Parameter 'isMeta'");
    expect(isMetaIssue.message).toContain('received string');

    const selectorIssue = result.error.issues.find(i => i.path[0] === 'selector')!;
    expect(selectorIssue.message).toContain("Missing required parameter 'selector'");
  });

  // Empty shape is a real case (status, abort, commit, refresh — zero-arg
  // tools). It must not throw.
  it('is a no-op on an empty shape', () => {
    expect(() => applyErrorMapToShape({})).not.toThrow();
  });

  // Crucially: setting the error per-schema must NOT touch the global
  // zod config (z.config). That's what makes this approach SDK-safe.
  it('does not mutate global zod config (other schemas use the default formatter)', () => {
    applyErrorMapToShape({ x: z.string() });

    // A separate schema not run through applyErrorMapToShape must still
    // produce zod's default message text, not ours.
    const other = z.object({ y: z.boolean() });
    const result = other.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(issue.message).not.toContain("Missing required parameter 'y'");
  });
});
