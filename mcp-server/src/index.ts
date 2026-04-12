import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { McpSession, McpSessionConfig } from './mcpSession';
import { registerTools } from './tools';

export interface CliArgs {
  libraryPath: string;
  stoneNrs: string;
  gemNrs: string;
  gsUser: string;
  gemstone: string;
  gemstoneGlobalDir: string;
  hostUser?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length - 1; i += 2) {
    const key = args[i].replace(/^--/, '');
    result[key] = args[i + 1];
  }
  const required = ['library-path', 'stone-nrs', 'gem-nrs', 'gs-user', 'gemstone', 'gemstone-global-dir'];
  for (const key of required) {
    if (!result[key]) {
      throw new Error(`Missing required argument: --${key}`);
    }
  }
  return {
    libraryPath: result['library-path'],
    stoneNrs: result['stone-nrs'],
    gemNrs: result['gem-nrs'],
    gsUser: result['gs-user'],
    gemstone: result['gemstone'],
    gemstoneGlobalDir: result['gemstone-global-dir'],
    hostUser: result['host-user'],
  };
}

export function createSessionConfig(args: CliArgs): McpSessionConfig {
  return {
    libraryPath: args.libraryPath,
    stoneNrs: args.stoneNrs,
    gemNrs: args.gemNrs,
    gsUser: args.gsUser,
    gsPassword: process.env.GS_PASSWORD || '',
    hostUser: args.hostUser,
    hostPassword: process.env.HOST_PASSWORD,
  };
}

export function createHttpServer(mcpServer: McpServer) {
  const app = express();

  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    await mcpServer.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(404).send('Session not found');
    }
  });

  return app;
}

async function main() {
  const args = parseArgs(process.argv);

  process.env.GEMSTONE = args.gemstone;
  process.env.GEMSTONE_GLOBAL_DIR = args.gemstoneGlobalDir;
  if (process.platform === 'darwin') {
    process.env.DYLD_LIBRARY_PATH = `${args.gemstone}/lib`;
  } else {
    process.env.LD_LIBRARY_PATH = `${args.gemstone}/lib`;
  }

  const sessionConfig = createSessionConfig(args);
  const session = new McpSession(sessionConfig);
  process.stderr.write(`MCP server: logged in as ${args.gsUser}\n`);

  const mcpServer = new McpServer({
    name: 'gemstone',
    version: '1.0.0',
  });
  registerTools(mcpServer, session);

  const app = createHttpServer(mcpServer);
  const server = app.listen(0, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.stdout.write(JSON.stringify({ port }) + '\n');
    process.stderr.write(`MCP server: listening on port ${port}\n`);
  });

  const shutdown = () => {
    process.stderr.write('MCP server: shutting down\n');
    session.logout();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (!process.env.VITEST) {
  main().catch(err => {
    process.stderr.write(`MCP server failed: ${err.message}\n`);
    process.exit(1);
  });
}
