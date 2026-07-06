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

export async function loadConfig(filePath: string): Promise<Config> {
  let mod: { default: unknown };
  try {
    mod = await import(pathToFileURL(resolve(filePath)).href);
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
  const plugins = Array.isArray(raw.plugins) ? (raw.plugins as DropSHPlugin[]) : [];

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
