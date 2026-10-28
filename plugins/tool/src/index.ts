import type { DropSHPlugin, PluginCommandServices } from "dropsh/plugin";
import { registerToolCommand } from "./command.js";
import { parseToolOptions } from "./options.js";

export { buildArguments } from "./args.js";
export type { ToolClient, ToolClientOptions, ToolInfo } from "./client.js";
export { createToolClient, ToolCallError, unknownToolError } from "./client.js";
export type { ToolOptions } from "./options.js";
export { parseToolOptions } from "./options.js";

export function toolPlugin(raw?: unknown): DropSHPlugin {
  const options = parseToolOptions(raw);
  return {
    id: "tool",
    requiredModules: [],
    registerCommands(program, services: PluginCommandServices) {
      registerToolCommand(program, services, options);
    },
  };
}
