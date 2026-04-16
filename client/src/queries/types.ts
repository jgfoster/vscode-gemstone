// Signature every shared query function is written against. Callers supply
// their own executor — the client wraps `browserQueries.executeFetchString`
// (which handles logging and busy-session checks); the MCP server wraps
// `McpSession.executeFetchString` (its own GCI session, no logging).
//
// The `label` is descriptive metadata used only for client-side logging.
// Executors that don't log can ignore it.
export type QueryExecutor = (label: string, code: string) => string;
