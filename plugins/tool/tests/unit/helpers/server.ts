import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface TestTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handler?: (args: Record<string, unknown>) => CallToolResult;
}

export interface TestServerOptions {
  /** When set, any request without exactly this Authorization header gets 401. */
  requireBearer?: string;
  /** tools/list page size; all tools on one page when omitted. */
  pageSize?: number;
  /** Return an HTTP status to short-circuit a JSON-RPC method before the MCP server sees it. */
  statusFor?: (method: string) => number | undefined;
}

export interface TestServer {
  url: string;
  baseUrl: string;
  calls: Array<{ name: string; args: unknown }>;
  methods: string[];
  seenAuth: string[];
  close(): Promise<void>;
}

export async function startTestMcpServer(
  tools: TestTool[],
  opts: TestServerOptions = {},
): Promise<TestServer> {
  const calls: TestServer["calls"] = [];
  const methods: string[] = [];
  const seenAuth: string[] = [];

  function createMcp(): Server {
    const server = new Server({ name: "test", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const start = Number(request.params?.cursor ?? 0);
      const size = opts.pageSize ?? tools.length;
      const page = tools.slice(start, start + size);
      const next = start + size < tools.length ? String(start + size) : undefined;
      return {
        tools: page.map(({ handler: _handler, ...tool }) => tool),
        ...(next === undefined ? {} : { nextCursor: next }),
      } as never;
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments ?? {};
      calls.push({ name: request.params.name, args });
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) return { content: [{ type: "text", text: "unknown tool" }], isError: true };
      return tool.handler ? tool.handler(args) : { content: [] };
    });
    return server;
  }

  const http = createServer((req, res) => {
    void (async () => {
      seenAuth.push(req.headers.authorization ?? "");
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: string };
      const method = parsed.method ?? "";
      methods.push(method);
      if (opts.requireBearer !== undefined && req.headers.authorization !== opts.requireBearer) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      const status = opts.statusFor?.(method);
      if (status !== undefined) {
        res.writeHead(status).end(`status ${status}`);
        return;
      }
      const mcp = createMcp();
      // Stateless: omit sessionIdGenerator so every request is handled on its own.
      const transport = new StreamableHTTPServerTransport();
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, parsed);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    url: `${baseUrl}/mcp`,
    baseUrl,
    calls,
    methods,
    seenAuth,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
