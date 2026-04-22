import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { ConfigError } from "../errors.js";

export interface AuthConfig {
  type: "basic" | "oauth2_password" | "oauth2_client_credentials" | "oauth2_authcode";
  [key: string]: unknown;
}

export interface SiteConfig {
  base_url: string;
  jsonapi_prefix: string;
  auth: AuthConfig;
}

export interface Config {
  site: SiteConfig;
  defaults: { dry_run: boolean; timeout_ms: number };
}

export interface LoadOptions {
  env?: Record<string, string | undefined>;
  parse?: (raw: string) => unknown;
}

const ENV_REF = /\$\{([A-Z0-9_]+)\}/g;

function expandEnv(value: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_REF, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined) {
        throw new ConfigError(`Environment variable ${name} is not set`, { name });
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v, env);
    return out;
  }
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function loadConfig(filePath: string, opts: LoadOptions = {}): Promise<Config> {
  const env = opts.env ?? process.env;
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read config file: ${filePath}`, { cause: String(err) });
  }

  let parsed: unknown;
  try {
    parsed = opts.parse ? opts.parse(raw) : yaml.load(raw);
  } catch (err) {
    throw new ConfigError(`Cannot parse config: ${(err as Error).message}`, { path: filePath });
  }

  const expanded = expandEnv(parsed, env);
  if (!isRecord(expanded)) throw new ConfigError("Config root must be an object");

  const site = expanded.site;
  if (!isRecord(site)) throw new ConfigError("site section missing");
  if (typeof site.base_url !== "string" || site.base_url.length === 0)
    throw new ConfigError("site.base_url required");
  if (!isRecord(site.auth)) throw new ConfigError("site.auth section missing");
  if (typeof site.auth.type !== "string") throw new ConfigError("site.auth.type required");

  const defaults = isRecord(expanded.defaults) ? expanded.defaults : {};

  return {
    site: {
      base_url: site.base_url,
      jsonapi_prefix: typeof site.jsonapi_prefix === "string" ? site.jsonapi_prefix : "/jsonapi",
      auth: site.auth as AuthConfig,
    },
    defaults: {
      dry_run: defaults.dry_run === true,
      timeout_ms: typeof defaults.timeout_ms === "number" ? defaults.timeout_ms : 30000,
    },
  };
}
