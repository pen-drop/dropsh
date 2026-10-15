import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AuthAdapter, CommandContext } from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";
import type { McpOptions } from "./options.js";
import { createMcpServer } from "./server.js";

const BODY_LIMIT = 1024 * 1024;

export type ServeMode = { type: "stdio" } | { type: "http"; port: number };

export function resolveServeMode(flags: { stdio?: boolean; http?: string }): ServeMode {
  const stdio = Boolean(flags.stdio);
  const http = flags.http !== undefined;
  if (stdio === http) {
    throw new ConfigError("mcp serve requires exactly one of --stdio or --http");
  }
  if (stdio) return { type: "stdio" };
  const port = Number(flags.http);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`mcp serve --http requires an integer port 1–65535, got '${flags.http}'`);
  }
  return { type: "http", port };
}

function bearerAdapter(authorization: string): AuthAdapter {
  return {
    apply: async (req) => ({
      ...req,
      headers: { ...req.headers, Authorization: authorization },
    }),
  };
}

const anonymousAdapter: AuthAdapter = {
  apply: async (req) => req,
};

function parseAuthorization(
  header: string | string[] | undefined,
): { kind: "missing" } | { kind: "bearer"; value: string } | { kind: "invalid" } {
  if (header === undefined || header === "") return { kind: "missing" };
  if (Array.isArray(header) || typeof header !== "string") return { kind: "invalid" };
  if (/^Bearer \S+$/i.test(header)) return { kind: "bearer", value: header };
  return { kind: "invalid" };
}

export function bindRequestAuth(ctx: CommandContext, authorization: string | undefined): void {
  const inner = ctx.http.send.bind(ctx.http);
  const allowedOrigin = new URL(ctx.baseUrl).origin;
  ctx.http.send = async (req) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers ?? {})) {
      if (key.toLowerCase() !== "authorization") headers[key] = value;
    }
    let targetOrigin = "";
    try {
      targetOrigin = new URL(req.url).origin;
    } catch {
      targetOrigin = "";
    }
    if (authorization !== undefined && targetOrigin === allowedOrigin) {
      headers.Authorization = authorization;
    }
    return inner({ ...req, headers });
  };
}

class BodyLimitError extends Error {
  constructor() {
    super("request body exceeds 1 MiB");
    this.name = "BodyLimitError";
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const length = Number(req.headers["content-length"] ?? 0);
  if (length > limit) throw new BodyLimitError();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new BodyLimitError();
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function allowedHost(port: number): string {
  return `127.0.0.1:${port}`;
}

function allowedOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function startMcpHttpServer(opts: {
  options: McpOptions;
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>;
  port?: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  let actualPort = opts.port ?? 0;
  const server = createServer((req, res) => {
    void handleHttp(req, res, opts.options, opts.getContext, actualPort);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  actualPort = typeof address === "object" && address ? address.port : actualPort;
  return {
    port: actualPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  options: McpOptions,
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>,
  port: number,
): Promise<void> {
  try {
    if (req.headers.host !== allowedHost(port)) {
      res.writeHead(400).end("invalid host");
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== allowedOrigin(port)) {
      res.writeHead(400).end("invalid origin");
      return;
    }
    const url = new URL(req.url ?? "/", allowedOrigin(port));
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(405, { Allow: "POST" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        }),
      );
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const auth = parseAuthorization(req.headers.authorization);
    if (auth.kind === "invalid") {
      res.writeHead(400).end("invalid authorization");
      return;
    }
    let parsed: unknown;
    try {
      const raw = await readBody(req, BODY_LIMIT);
      parsed = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      if (err instanceof BodyLimitError) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      res.writeHead(400).end("invalid json");
      return;
    }
    const adapter = auth.kind === "bearer" ? bearerAdapter(auth.value) : anonymousAdapter;
    const boundGetContext = async () => {
      const ctx = await getContext(adapter);
      bindRequestAuth(ctx, auth.kind === "bearer" ? auth.value : undefined);
      return ctx;
    };
    const mcp = createMcpServer(options, boundGetContext);
    // Stateless: omit sessionIdGenerator so the SDK disables session management.
    const transport = new StreamableHTTPServerTransport();
    const cleanup = () => {
      void transport.close();
      void mcp.close();
    };
    res.on("close", cleanup);
    await mcp.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, parsed);
  } catch {
    if (!res.headersSent) res.writeHead(500).end();
  }
}

export async function serveStdio(opts: {
  options: McpOptions;
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
}): Promise<void> {
  const mcp = createMcpServer(opts.options, opts.getContext);
  const transport = new StdioServerTransport(opts.stdin, opts.stdout);
  await mcp.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    opts.stdin?.on("end", () => {
      void transport.close();
    });
  });
}
