import type { DropSHPlugin } from "dropsh/plugin";

export type { ToolClient, ToolClientOptions, ToolInfo } from "./client.js";
export { createToolClient, ToolCallError, unknownToolError } from "./client.js";
export type { ToolOptions } from "./options.js";
export { parseToolOptions } from "./options.js";

export function toolPlugin(): DropSHPlugin {
  return { id: "tool", requiredModules: [] };
}
