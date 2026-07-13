import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError } from "../errors.js";
import type { DropSHPlugin, PluginDescriptor } from "./plugin.js";

export interface SiteConfig {
  base_url: string;
  jsonapi_prefix: string;
}

export interface Config {
  site: SiteConfig;
  defaults: { dry_run: boolean; timeout_ms: number };
  plugins: DropSHPlugin[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * A plugin descriptor is plain config data that names a plugin package as a
 * string (`plugin`). This lets a committed config stay import-free: the config
 * carries only data, and dropsh resolves + constructs the plugin from its own
 * install — so nothing has to resolve the plugin package from the config file's
 * own `import` statements (which resolve relative to the config file, not the CLI).
 */
function isPluginDescriptor(e: unknown): e is PluginDescriptor {
  return isRecord(e) && typeof e.plugin === "string";
}

/**
 * Resolve a single named-plugin descriptor to its module path + export the way
 * ESLint resolves plugins: by string name against a list of base modules, first
 * match wins (so a plugin installed alongside dropsh — a dropsh dep, or globally
 * next to a global dropsh, or via `npx -p` — is found). The config never imports
 * the package itself. This does **not** call the plugin factory: the resolved
 * path + export + options form the identity the graph expander de-duplicates on,
 * so construction is deferred to a cache miss (a shared/diamond dependency's
 * factory must run exactly once — AC-3). Returns a `construct` thunk the caller
 * invokes only when the resolved identity is new.
 */
async function resolveDescriptor(
  entry: PluginDescriptor,
  bases: string[],
  declaredBy: string | undefined,
): Promise<{ resolvedPath: string; exportName: string; construct: () => DropSHPlugin }> {
  const name = entry.plugin;
  let resolved: string | undefined;
  for (const base of bases) {
    try {
      resolved = createRequire(base).resolve(name);
      break;
    } catch {
      // try the next base
    }
  }
  if (resolved === undefined) {
    const from = declaredBy ? ` (declared by '${declaredBy}')` : "";
    throw new ConfigError(
      `cannot resolve plugin '${name}'${from}. Install it next to dropsh (project dep, dropsh dep, global next to a global dropsh, or 'npx -p dropsh -p ${name}').`,
    );
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`cannot load plugin '${name}'`, { cause: String(err) });
  }
  const exportName = typeof entry.export === "string" ? entry.export : "default";
  const factory = mod[exportName];
  if (typeof factory !== "function")
    throw new ConfigError(`plugin '${name}' has no callable export '${exportName}'`);
  const construct = () =>
    (factory as (opts?: unknown) => DropSHPlugin)(entry.with ?? entry.options);
  return { resolvedPath: resolved, exportName, construct };
}

/**
 * Expands `plugins[]` into a flat plugin list: named-package descriptors are
 * resolved + built, and each built plugin's `dependencies` are expanded
 * *before* it (post-order DFS). A descriptor's identity is its resolved module
 * path + export + options (`with`/`options`) — that single key drives both
 * de-duplication and on-path cycle detection, and construction happens only on a
 * cache miss, so a shared dependency's factory runs exactly once (AC-3). Because
 * the key is the *resolved* module, one relative string naming different files
 * on a path is not a cycle, and two same-package entries with different options
 * are two distinct plugins. `id` collisions are still de-duplicated in the final
 * list. A dependency cycle is rejected with the offending chain of descriptor
 * names. Pre-constructed plugin objects pass through unchanged (backward compat).
 */
async function resolvePlugins(raw: unknown, configPath: string): Promise<DropSHPlugin[]> {
  if (!Array.isArray(raw)) return [];

  const baseBases = [
    pathToFileURL(configPath).href,
    pathToFileURL(`${process.cwd()}/`).href,
    import.meta.url,
  ];
  const out: DropSHPlugin[] = [];
  const doneKeys = new Set<string>(); // resolvedPath::export::options — fully expanded
  const doneIds = new Set<string>(); // plugin.id already emitted
  // Descriptors on the current DFS path, keyed by resolved identity; `name` is
  // the descriptor string, kept only to render the cycle-error chain.
  const stack: { key: string; name: string }[] = [];

  const emit = (plugin: DropSHPlugin): void => {
    if (doneIds.has(plugin.id)) return;
    doneIds.add(plugin.id);
    out.push(plugin);
  };

  const expandDeps = async (plugin: DropSHPlugin, bases: string[]): Promise<void> => {
    for (const dep of plugin.dependencies ?? []) await expand(dep, bases, plugin.id);
  };

  async function expand(
    entry: unknown,
    bases: string[],
    declaredBy: string | undefined,
  ): Promise<void> {
    if (!isPluginDescriptor(entry)) {
      // Pre-constructed plugin object: expand its deps first, then emit it.
      const plugin = entry as DropSHPlugin;
      await expandDeps(plugin, bases);
      emit(plugin);
      return;
    }

    const { resolvedPath, exportName, construct } = await resolveDescriptor(
      entry,
      bases,
      declaredBy,
    );
    const key = `${resolvedPath}::${exportName}::${JSON.stringify(entry.with ?? entry.options ?? null)}`;
    if (doneKeys.has(key)) return; // same resolved identity already expanded + emitted — do not re-construct
    if (stack.some((f) => f.key === key))
      throw new ConfigError(
        `plugin dependency cycle: ${[...stack.map((f) => f.name), entry.plugin].join(" → ")}`,
      );

    const plugin = construct();
    stack.push({ key, name: entry.plugin });
    try {
      // Child descriptors resolve relative to this plugin's module first.
      const childBases = [pathToFileURL(resolvedPath).href, ...baseBases];
      await expandDeps(plugin, childBases);
    } finally {
      stack.pop();
    }

    doneKeys.add(key);
    emit(plugin);
  }

  for (const entry of raw) await expand(entry, baseBases, undefined);
  return out;
}

export async function loadConfig(filePath: string): Promise<Config> {
  const configPath = resolve(filePath);
  let mod: { default: unknown };
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (err) {
    throw new ConfigError(`Cannot load config file: ${filePath}`, { cause: String(err) });
  }

  const raw = mod.default;
  if (!isRecord(raw)) throw new ConfigError("Config default export must be an object");

  const site = raw.site;
  if (!isRecord(site)) throw new ConfigError("site section missing");
  if (typeof site.base_url !== "string" || site.base_url.length === 0)
    throw new ConfigError("site.base_url required");

  const defaults = isRecord(raw.defaults) ? raw.defaults : {};
  const plugins = await resolvePlugins(raw.plugins, configPath);

  return {
    site: {
      base_url: site.base_url,
      jsonapi_prefix: typeof site.jsonapi_prefix === "string" ? site.jsonapi_prefix : "/jsonapi",
    },
    defaults: {
      dry_run: defaults.dry_run === true,
      timeout_ms: typeof defaults.timeout_ms === "number" ? defaults.timeout_ms : 30000,
    },
    plugins,
  };
}
