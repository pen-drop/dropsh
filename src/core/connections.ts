import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { ConfigError } from "../errors.js";
import { loadConfigSite } from "./config.js";
import { defaultConnectionsDir } from "./paths.js";

/** The name of the config file dropsh falls back to in the current directory. */
export const CWD_CONFIG_FILE = "dropsh.config.js";

/** Which selector produced the resolved config path. */
export type ConfigSourceKind =
  | "flag-config"
  | "flag-connection"
  | "env-config"
  | "env-connection"
  | "cwd";

/** The chosen config file plus the provenance of that choice. */
export interface ConfigSource {
  path: string;
  source: ConfigSourceKind;
  /** The connection id, when the winning selector named an entry rather than a file. */
  id?: string;
}

export interface ResolveConnectionsDirInput {
  /** `--connections-dir <path>`. */
  flag?: string | undefined;
  env?: NodeJS.ProcessEnv;
}

/**
 * The connections directory: `--connections-dir` > `$DROPSH_CONNECTIONS_DIR` >
 * `~/.config/dropsh/connections`. Resolved independently of which config
 * selector wins, because `connections list` reports the directory either way.
 */
export function resolveConnectionsDir(input: ResolveConnectionsDirInput = {}): string {
  const env = input.env ?? process.env;
  return input.flag ?? env.DROPSH_CONNECTIONS_DIR ?? defaultConnectionsDir();
}

export interface ResolveConfigSourceInput {
  /** `--config <path>`. */
  config?: string | undefined;
  /** `--connection <id>`. */
  connection?: string | undefined;
  connectionsDir?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function connectionPath(dir: string, id: string): string {
  return join(dir, `${id}.js`);
}

function toIds(entries: string[]): string[] {
  return entries
    .filter((name) => name.endsWith(".js"))
    .map((name) => basename(name, ".js"))
    .sort();
}

/**
 * Sorted ids of the `.js` files in `dir`; `[]` when the directory is absent.
 * Synchronous because it is only reached on the unknown-id error path, and the
 * resolver itself has to stay synchronous for the commander option wiring.
 */
function listConnectionIdsSync(dir: string): string[] {
  try {
    return toIds(readdirSync(dir));
  } catch {
    return [];
  }
}

/**
 * Resolve the config file for this invocation, highest selector first:
 * `--config` > `--connection` > `$DROPSH_CONFIG` > `$DROPSH_CONNECTION` >
 * `./dropsh.config.js`. `--config` and `--connection` together is not an error:
 * `--config` names a *file* and that is its stated meaning, so it wins silently.
 *
 * Returns the path *and* its provenance, so every caller — the command context,
 * the auth wiring, the pre-parse plugin bootstrap and `connections list` — reads
 * the same answer instead of re-deriving the chain.
 */
export function resolveConfigSource(input: ResolveConfigSourceInput = {}): ConfigSource {
  const env = input.env ?? process.env;
  const dir = input.connectionsDir ?? resolveConnectionsDir({ env });
  const cwd = input.cwd ?? process.cwd();

  if (input.config) return { path: input.config, source: "flag-config" };
  if (input.connection) {
    return {
      path: requireConnection(dir, input.connection),
      source: "flag-connection",
      id: input.connection,
    };
  }
  if (env.DROPSH_CONFIG) return { path: env.DROPSH_CONFIG, source: "env-config" };
  if (env.DROPSH_CONNECTION) {
    const id = env.DROPSH_CONNECTION;
    return { path: requireConnection(dir, id), source: "env-connection", id };
  }
  return { path: join(cwd, CWD_CONFIG_FILE), source: "cwd" };
}

/**
 * The path of connection `id`, or a `ConfigError` naming the id, the directory
 * searched and the available ids. Nothing prompts and nothing is created: an
 * unattended dispatch must fail rather than hang.
 */
function requireConnection(dir: string, id: string): string {
  const path = connectionPath(dir, id);
  if (existsSync(path)) return path;
  const available = listConnectionIdsSync(dir);
  const tail =
    available.length > 0
      ? `Available in ${dir}: ${available.join(", ")}.`
      : `no connections found in ${dir}.`;
  throw new ConfigError(`Unknown connection '${id}'. ${tail}`);
}

/** One row of `connections list`: a connection's id and either its base URL or its error. */
export interface ConnectionEntry {
  id: string;
  baseUrl?: string;
  error?: string;
}

/**
 * Every `.js` file in `dir`, by basename, sorted, with its `site.base_url`. A
 * file that cannot be imported, or that declares no usable `site`, is a row
 * carrying its error rather than an abort: the listing reports exactly what is
 * on disk. Plugins are never constructed, so one connection naming an
 * uninstalled package cannot take the others down with it.
 */
export async function listConnections(dir: string): Promise<ConnectionEntry[]> {
  const ids = await listConnectionIds(dir);
  return Promise.all(
    ids.map(async (id) => {
      try {
        const site = await loadConfigSite(connectionPath(dir, id));
        return { id, baseUrl: site.base_url };
      } catch (err) {
        return { id, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

/** Sorted ids of the `.js` files in `dir`; `[]` when the directory is absent. */
export async function listConnectionIds(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return toIds(entries);
}
