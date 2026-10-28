import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type CallToolResult, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  type AuthAdapter,
  AuthError,
  CliError,
  HttpError,
  ValidationError,
  validatePayload,
} from "dropsh/plugin";
import { authFetch } from "./fetch.js";

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface ToolClientOptions {
  auth: AuthAdapter;
  baseUrl: string;
  endpoint?: string;
  fetch?: typeof fetch;
}

export interface ToolClient {
  list(): Promise<ToolInfo[]>;
  get(name: string): Promise<ToolInfo | undefined>;
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** A tool ran and reported failure (`isError: true`). */
export class ToolCallError extends CliError {
  constructor(tool: string, content: unknown[]) {
    const text = content
      .flatMap((c) =>
        (c as { type?: string }).type === "text" ? [(c as { text: string }).text] : [],
      )
      .join("\n");
    super("E_TOOL", text || `tool ${tool} reported an error`, { tool, content });
    this.name = "ToolCallError";
  }
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
}

/** ValidationError for a tool name the server does not list, naming up to five closest names. */
export function unknownToolError(name: string, tools: ToolInfo[]): ValidationError {
  const closest = tools
    .map((t) => t.name)
    .sort(
      (a, b) =>
        sharedPrefix(b, name) - sharedPrefix(a, name) ||
        levenshtein(a, name) - levenshtein(b, name),
    )
    .slice(0, 5);
  const hint = closest.length > 0 ? `; closest: ${closest.join(", ")}` : "";
  return new ValidationError(`unknown tool '${name}'${hint}`, { tool: name, closest });
}

function mapError(err: unknown, url: string): unknown {
  if (err instanceof StreamableHTTPError) {
    if (err.code === 401 || err.code === 403) {
      return new AuthError(
        `MCP endpoint ${url} rejected the credentials (HTTP ${err.code}): the account needs the 'access mcp server' permission, and bearer tokens need the mcp_server_oauth module on the site`,
        { status: err.code },
      );
    }
    if (err.code === 404) {
      return new HttpError(404, `no MCP endpoint at ${url} (is mcp_server enabled?)`);
    }
    return new HttpError(err.code ?? 0, err.message);
  }
  if (err instanceof McpError) return new HttpError(0, err.message, { code: err.code });
  return err;
}

export function createToolClient(opts: ToolClientOptions): ToolClient {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${opts.endpoint ?? "/mcp"}`;
  let session: Promise<{ client: Client; transport: StreamableHTTPClientTransport }> | undefined;
  let tools: Promise<ToolInfo[]> | undefined;

  function connect() {
    session ??= (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        fetch: authFetch(opts.auth, opts.fetch),
      });
      const client = new Client({ name: "dropsh-tool", version: "0.7.5" });
      await client.connect(transport as unknown as Transport);
      return { client, transport };
    })().catch((err: unknown) => {
      session = undefined;
      throw err;
    });
    return session;
  }

  async function fetchAll(): Promise<ToolInfo[]> {
    const { client } = await connect();
    const all: ToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor === undefined ? {} : { cursor });
      for (const t of page.tools) {
        const title = t.title ?? t.annotations?.title;
        all.push({
          name: t.name,
          ...(title === undefined ? {} : { title }),
          ...(t.description === undefined ? {} : { description: t.description }),
          inputSchema: t.inputSchema as Record<string, unknown>,
          ...(t.outputSchema === undefined
            ? {}
            : { outputSchema: t.outputSchema as Record<string, unknown> }),
        });
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return all;
  }

  const api: ToolClient = {
    list() {
      tools ??= fetchAll().catch((err: unknown) => {
        tools = undefined;
        throw mapError(err, url);
      });
      return tools;
    },
    async get(name) {
      return (await api.list()).find((t) => t.name === name);
    },
    async call(name, args) {
      const all = await api.list();
      const tool = all.find((t) => t.name === name);
      if (!tool) throw unknownToolError(name, all);
      validatePayload(tool.inputSchema, args, `tool ${name}`);
      let result: CallToolResult;
      try {
        const { client } = await connect();
        result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      } catch (err) {
        throw mapError(err, url);
      }
      if (result.isError) throw new ToolCallError(name, result.content);
      return result;
    },
    async close() {
      const current = session;
      session = undefined;
      tools = undefined;
      if (!current) return;
      const { client, transport } = await current.catch(() => ({
        client: undefined,
        transport: undefined,
      }));
      await transport?.terminateSession().catch(() => {});
      await client?.close();
    },
  };
  return api;
}
