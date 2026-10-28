import { ConfigError } from "dropsh/plugin";

export interface ToolOptions {
  endpoint: string;
}

export function parseToolOptions(raw: unknown): ToolOptions {
  const input = (raw ?? {}) as Record<string, unknown>;
  const endpoint = input.endpoint ?? "/mcp";
  if (typeof endpoint !== "string" || !endpoint.startsWith("/")) {
    throw new ConfigError(`toolPlugin: endpoint must be a path starting with '/'`);
  }
  return { endpoint };
}
