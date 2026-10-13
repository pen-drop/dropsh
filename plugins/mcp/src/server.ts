import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type AuthAdapter, type CommandContext, HttpError } from "dropsh/plugin";
import type { McpOptions } from "./options.js";
import { createToolHandlers } from "./tools.js";

export function promptResourceUri(name: string): string {
  return `dropsh://prompts/${encodeURIComponent(name)}`;
}

export function createMcpServer(
  options: McpOptions,
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>,
  markdownSnapshot: Map<string, string> = new Map(),
): Server {
  const handlers = createToolHandlers(options, getContext);
  const names = [...markdownSnapshot.keys()].sort();
  const server = new Server(
    { name: "dropsh-mcp", version: "0.7.5" },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      const tools = await handlers.list();
      return { tools };
    } catch (err) {
      if (err instanceof HttpError) {
        throw new McpError(ErrorCode.InternalError, err.message, { backendStatus: err.status });
      }
      throw err;
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return (await handlers.call(
      request.params.name,
      request.params.arguments ?? {},
    )) as unknown as CallToolResult;
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: names.map((name) => ({ name })),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const text = markdownSnapshot.get(request.params.name);
    if (text === undefined) {
      throw new McpError(ErrorCode.InvalidParams, `unknown prompt '${request.params.name}'`);
    }
    return { messages: [{ role: "user", content: { type: "text", text } }] };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: names.map((name) => ({
      uri: promptResourceUri(name),
      name,
      mimeType: "text/markdown",
    })),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const prefix = "dropsh://prompts/";
    if (!uri.startsWith(prefix)) {
      throw new McpError(ErrorCode.InvalidParams, `unknown resource '${uri}'`);
    }
    const name = decodeURIComponent(uri.slice(prefix.length));
    const text = markdownSnapshot.get(name);
    if (text === undefined) {
      throw new McpError(ErrorCode.InvalidParams, `unknown resource '${uri}'`);
    }
    return { contents: [{ uri, mimeType: "text/markdown", text }] };
  });

  return server;
}
