import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AuthAdapter } from "dropsh/plugin";
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
    })();
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
        throw err;
      });
      return tools;
    },
    async get(name) {
      return (await api.list()).find((t) => t.name === name);
    },
    async call() {
      throw new Error("not implemented");
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
