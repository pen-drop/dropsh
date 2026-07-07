import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError } from "../errors.js";
import type { DropSHPlugin } from "./plugin.js";

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
function isPluginDescriptor(e: unknown): e is Record<string, unknown> & { plugin: string } {
  return isRecord(e) && typeof e.plugin === "string";
}

/**
 * Resolve a named plugin package the way ESLint resolves plugins: by string
 * name, relative to the config file first, then the cwd, then dropsh's own
 * install (so a plugin installed alongside dropsh — a dropsh dep, or globally
 * next to a global dropsh, or via `npx -p`— is found). The config never imports
 * the package itself.
 */
async function loadNamedPlugin(
  entry: Record<string, unknown> & { plugin: string },
  configPath: string,
): Promise<DropSHPlugin> {
  const name = entry.plugin;
  const bases = [
    pathToFileURL(configPath).href,
    pathToFileURL(`${process.cwd()}/`).href,
    import.meta.url,
  ];
  let resolved: string | undefined;
  for (const base of bases) {
    try {
      resolved = createRequire(base).resolve(name);
      break;
    } catch {
      // try the next base
    }
  }
  if (resolved === undefined)
    throw new ConfigError(
      `cannot resolve plugin '${name}'. Install it next to dropsh (project dep, dropsh dep, global next to a global dropsh, or 'npx -p dropsh -p ${name}').`,
    );

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
  return (factory as (opts?: unknown) => DropSHPlugin)(entry.with ?? entry.options);
}

/**
 * Expands `plugins[]` entries: named-package descriptors are resolved + built
 * into real plugins; already-constructed plugins pass through unchanged
 * (backward compat).
 */
async function resolvePlugins(raw: unknown, configPath: string): Promise<DropSHPlugin[]> {
  if (!Array.isArray(raw)) return [];
  return Promise.all(
    raw.map((entry) =>
      isPluginDescriptor(entry)
        ? loadNamedPlugin(entry, configPath)
        : Promise.resolve(entry as DropSHPlugin),
    ),
  );
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
