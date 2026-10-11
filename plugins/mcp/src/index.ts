import type { DropSHPlugin, PluginCommandServices } from "dropsh/plugin";
import { parseMcpOptions } from "./options.js";
import { resolveServeMode, serveStdio, startMcpHttpServer } from "./transports.js";

export { parseMcpOptions } from "./options.js";
export { createMcpServer } from "./server.js";
export { buildInputSchema, createToolHandlers } from "./tools.js";
export { bindRequestAuth, resolveServeMode, serveStdio, startMcpHttpServer } from "./transports.js";

export function mcpPlugin(raw: unknown): DropSHPlugin {
  const options = parseMcpOptions(raw);
  return {
    id: "mcp",
    requiredModules: [],
    registerCommands(program, services: PluginCommandServices) {
      program
        .command("mcp")
        .description("Model Context Protocol server")
        .command("serve")
        .description("Serve MCP over stdio or loopback HTTP")
        .option("--stdio", "serve MCP over stdio")
        .option("--http <port>", "serve MCP over HTTP on 127.0.0.1")
        .action(async (flags: { stdio?: boolean; http?: string }) => {
          const mode = resolveServeMode(flags);
          const markdown = new Map<string, string>();
          if (mode.type === "stdio") {
            await serveStdio({
              options,
              getContext: (auth) => services.getContext(auth),
              markdown,
            });
            return;
          }
          const started = await startMcpHttpServer({
            options,
            getContext: (auth) => services.getContext(auth),
            markdown,
            port: mode.port,
          });
          await new Promise<void>((resolve) => {
            const stop = () => {
              void started.close().then(resolve);
            };
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
          });
        });
    },
  };
}
