import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { type AuthAdapter, type CommandContext, HttpError } from "dropsh/plugin";
import type { McpOptions } from "./options.js";
import { createToolHandlers } from "./tools.js";

export function createMcpServer(
  options: McpOptions,
  getContext: (auth?: AuthAdapter) => Promise<CommandContext>,
): Server {
  const handlers = createToolHandlers(options, getContext);
  const server = new Server(
    { name: "dropsh-mcp", version: "0.7.5" },
    { capabilities: { tools: {} } },
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

  return server;
}
