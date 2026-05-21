import { z } from 'zod';

// Custom zod error map for MCP tool input validation.
//
// Why this exists: when an MCP tool call fails schema validation, the SDK
// passes zod's error message through to the JSON-RPC response verbatim
// (verified via probe). Zod's default message — "Invalid input: expected
// boolean, received undefined" — does not name *which* parameter was wrong,
// so an agent reading just the message can't recover. Path *is* available
// in the structured issue, but the message is what most agents read first.
//
// Why per-schema (not global): the MCP SDK uses zod internally to parse
// JSON-RPC messages via discriminated unions over request/response/error
// shapes. Failed branches of those unions emit invalid_type issues as a
// normal control-flow signal. Setting `z.config({ customError })` globally
// rewrites *those* messages too and breaks the SDK's protocol parsing
// (manifests as request hangs at runtime). Attaching the error map per
// tool-input field via the schema's own `_zod.def.error` slot — which zod
// consults *before* the global config — keeps our messages scoped to the
// schemas we own.
//
// Limitations: zod's error map context does not expose the schema definition,
// so we can't pull each field's `.describe()` text into the message. Agents
// recover via the tool's overall description plus the named path — which is
// already much better than the default.

export const mcpErrorMap: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === 'invalid_type') {
    const path = formatPath(issue.path);
    const expected = issue.expected;
    if (issue.input === undefined) {
      return {
        message: `Missing required parameter '${path}' (expected ${expected}).`,
      };
    }
    const received = describeReceived(issue.input);
    return {
      message: `Parameter '${path}' must be ${expected}, but received ${received}.`,
    };
  }

  // Fall through to the default formatter for codes we don't specialize.
  // unrecognized_keys is unreachable for the SDK's tool-input parsing
  // (default z.object is non-strict — unknown keys are silently dropped and
  // the relevant signal becomes a missing-required error elsewhere), so we
  // don't bother with a custom message there.
  return undefined;
};

// Attach the MCP error map to every field schema in a tool-input shape.
// Mutates the shape in place; returns it so call sites can chain.
//
// Why mutate `_zod.def.error` directly: the SDK's `server.tool(name, desc,
// shape, cb)` API takes a raw shape, not a ZodObject, so we can't pass an
// `error` option through the public ZodObject constructor. The `_zod.def`
// slot is the same field zod's runtime checks first when formatting an
// issue — setting it imperatively preserves all chained metadata (.describe,
// .optional, etc.) on each field.
export function applyErrorMapToShape<T extends z.ZodRawShape>(shape: T): T {
  for (const key of Object.keys(shape)) {
    const schema = shape[key] as unknown as { _zod: { def: { error?: z.core.$ZodErrorMap } } };
    schema._zod.def.error = mcpErrorMap;
  }
  return shape;
}

// Wrap an McpServer so every `server.tool(...)` call automatically applies
// the MCP error map to its input shape. Returns a shim with the same
// surface as the underlying server's `tool` method.
//
// Why wrap rather than monkey-patch: we want the change to be local to
// registerTools/registerMcpTools — tests that exercise the raw McpServer
// shouldn't see an instrumented prototype.
//
// Why `any[]` rather than `unknown[]`: McpServer's `tool` method has multiple
// overloads with specific parameter types (e.g. `name: string`, `cb: ...`).
// `unknown[]` is contravariantly *narrower* than those overloads (a function
// expecting `unknown` cannot be called with `string` safely from TS's
// perspective), so a strict signature here would reject the real McpServer.
// `any[]` opts out of that check, matching the runtime reality that we
// inspect the args dynamically and forward them through.
export function withMcpErrorMap(
  server: { tool: (...args: any[]) => any },
): { tool: (...args: any[]) => any } {
  const original = server.tool.bind(server);
  return {
    tool(...args: any[]) {
      // server.tool overloads:
      //   (name, cb)
      //   (name, description, cb)
      //   (name, shapeOrAnnotations, cb)
      //   (name, description, shapeOrAnnotations, cb)
      // Apply the error map only when arg[2] (or arg[1]) looks like a
      // tool-input shape (Record<string, ZodTypeAny>). Empty shapes ({})
      // are also caught and pass through harmlessly.
      for (const arg of args) {
        if (isToolInputShape(arg)) {
          applyErrorMapToShape(arg);
          break;
        }
      }
      return original(...args);
    },
  };
}

// Heuristic: a tool-input shape is a plain object whose values are ZodType
// instances. ToolAnnotations also pass `Record<string, unknown>` but its
// values aren't zod schemas, so the `_zod` check filters them out.
function isToolInputShape(value: unknown): value is z.ZodRawShape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return true; // empty shape — wrap a no-op
  return keys.every(k => {
    const v = obj[k];
    return !!v && typeof v === 'object' && '_zod' in v;
  });
}

function formatPath(path: PropertyKey[] | undefined): string {
  if (!path || path.length === 0) return '<root>';
  return path.map(p => String(p)).join('.');
}

// Approximate the "received <type>" phrasing of zod's default. We can't get
// at zod's internal type detector from the error map context, so we map the
// few primitive cases that show up in MCP tool inputs.
function describeReceived(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input;
}
