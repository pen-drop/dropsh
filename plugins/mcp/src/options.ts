import { ConfigError } from "dropsh/plugin";

export const TOOL_NAMES = [
  "list_entities",
  "search",
  "read",
  "create",
  "update",
  "describe",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface McpOptions {
  bundles: string[];
  operations: ToolName[];
  markdownDir?: string;
}

export interface BundleSelector {
  entityType: string;
  bundle: string;
}

const SELECTOR_RE = /^[a-z0-9_]+\/[a-z0-9_]+$/;
const TOOL_SET = new Set<string>(TOOL_NAMES);

export function parseBundleSelector(value: string): BundleSelector {
  if (!SELECTOR_RE.test(value)) {
    throw new ConfigError(`mcpPlugin: invalid bundle selector '${value}'`);
  }
  const [entityType, bundle] = value.split("/") as [string, string];
  return { entityType, bundle };
}

export function parseMcpOptions(raw: unknown): McpOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("mcpPlugin: options object required");
  }
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.bundles)) {
    throw new ConfigError("mcpPlugin: bundles must be an array");
  }
  if (!Array.isArray(input.operations)) {
    throw new ConfigError("mcpPlugin: operations must be an array");
  }

  const bundles: string[] = [];
  const seenBundles = new Set<string>();
  for (const item of input.bundles) {
    if (typeof item !== "string") {
      throw new ConfigError("mcpPlugin: each bundles entry must be a string");
    }
    parseBundleSelector(item);
    if (seenBundles.has(item)) {
      throw new ConfigError(`mcpPlugin: duplicate bundle '${item}'`);
    }
    seenBundles.add(item);
    bundles.push(item);
  }

  const operations: ToolName[] = [];
  const seenOps = new Set<string>();
  for (const item of input.operations) {
    if (typeof item !== "string" || !TOOL_SET.has(item)) {
      throw new ConfigError(`mcpPlugin: unknown operation '${String(item)}'`);
    }
    if (seenOps.has(item)) {
      throw new ConfigError(`mcpPlugin: duplicate operation '${item}'`);
    }
    seenOps.add(item);
    operations.push(item as ToolName);
  }

  const options: McpOptions = { bundles, operations };
  if (input.markdownDir !== undefined) {
    if (typeof input.markdownDir !== "string" || input.markdownDir.length === 0) {
      throw new ConfigError("mcpPlugin: markdownDir must be a non-empty string");
    }
    options.markdownDir = input.markdownDir;
  }
  return options;
}

/** Empty allowlists expose no entity tools. */
export function isToolEnabled(options: McpOptions, name: ToolName): boolean {
  return options.operations.includes(name) && options.bundles.length > 0;
}
