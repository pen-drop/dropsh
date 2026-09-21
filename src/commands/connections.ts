import type { ConfigSource, ConnectionEntry } from "../core/connections.js";

export interface ConnectionsListArgs {
  /** The resolved connections directory. */
  dir: string;
  /** What this invocation would resolve to — the row it marks, when it names an id. */
  resolved: ConfigSource;
}

export interface ConnectionsListDeps {
  list: (dir: string) => Promise<ConnectionEntry[]>;
  emit: (v: unknown) => void | Promise<void>;
}

/** One listed connection, as it is emitted. */
export interface ConnectionsListRow {
  id: string;
  base_url?: string;
  error?: string;
  /** True on the single connection this invocation would resolve to. */
  current: boolean;
}

export interface ConnectionsListResult {
  directory: string;
  resolved: ConfigSource;
  connections: ConnectionsListRow[];
}

/**
 * List the connections in the resolved directory. A broken connection is a row
 * carrying its error, not an abort: the listing succeeded and reports exactly
 * what is on disk. When the invocation resolves to a path rather than an id —
 * `--config`, `$DROPSH_CONFIG`, or the cwd default — no row is marked and the
 * resolved path stands on its own in `resolved`.
 */
export async function runConnectionsList(
  args: ConnectionsListArgs,
  deps: ConnectionsListDeps,
): Promise<ConnectionsListResult> {
  const entries = await deps.list(args.dir);
  const result: ConnectionsListResult = {
    directory: args.dir,
    resolved: args.resolved,
    connections: entries.map((e) => ({
      id: e.id,
      ...(e.baseUrl !== undefined ? { base_url: e.baseUrl } : {}),
      ...(e.error !== undefined ? { error: e.error } : {}),
      current: e.id === args.resolved.id,
    })),
  };
  await deps.emit(result);
  return result;
}

/**
 * The listing as a human reads it: one row per connection, a `*` on the one in
 * force, and the resolved path stated below when no id is in force.
 */
export function renderConnectionsTable(result: ConnectionsListResult): string {
  const lines: string[] = [`Connections in ${result.directory}`];
  if (result.connections.length === 0) {
    lines.push("  (none)");
  }
  const width = Math.max(0, ...result.connections.map((c) => c.id.length));
  for (const c of result.connections) {
    const marker = c.current ? "*" : " ";
    const value = c.base_url ?? `! ${c.error ?? "unreadable"}`;
    lines.push(`${marker} ${c.id.padEnd(width)}  ${value}`);
  }
  if (result.resolved.id === undefined) {
    lines.push(`Resolved config: ${result.resolved.path} (${result.resolved.source})`);
  }
  return lines.join("\n");
}
