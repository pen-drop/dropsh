import { AuthError, ConfigError } from "../errors.js";
import { collectProviders, providerById } from "./auth/registry.js";
import { readSession, writeSession } from "./auth/session-store.js";
import type { AuthAdapter } from "./auth/types.js";
import { loadConfig } from "./config.js";
import type { HttpClient } from "./http.js";
import { createHttpClient } from "./http.js";
import { createJsonApiClient, type JsonApiClient } from "./jsonapi/client.js";
import type { DropSHPlugin } from "./plugin.js";

export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  plugins: DropSHPlugin[];
}

export interface ResolveAuthDeps {
  baseUrl: string;
  plugins: DropSHPlugin[];
  http: HttpClient;
  now: () => number;
  stateDir?: string;
}

export async function resolveAuth(deps: ResolveAuthDeps): Promise<AuthAdapter> {
  const rec = await readSession(deps.baseUrl, deps.stateDir);
  if (!rec) throw new AuthError("Not authenticated. Run 'dropsh auth login'.");
  const provider = providerById(collectProviders(deps.plugins), rec.activeProvider);
  if (!provider) throw new ConfigError(`active provider '${rec.activeProvider}' is not configured`);
  return provider.createAdapter(rec.session, {
    http: deps.http,
    now: deps.now,
    save: (session) => writeSession(deps.baseUrl, provider.id, session, deps.stateDir),
  });
}

export async function createCommandContext(configPath: string): Promise<CommandContext> {
  const cfg = await loadConfig(configPath);
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const auth = await resolveAuth({
    baseUrl: cfg.site.base_url,
    plugins: cfg.plugins,
    http,
    now: Date.now,
  });
  const client = createJsonApiClient({
    baseUrl: cfg.site.base_url,
    prefix: cfg.site.jsonapi_prefix,
    http,
    auth,
  });
  return {
    client,
    http,
    auth,
    baseUrl: cfg.site.base_url,
    jsonapiPrefix: cfg.site.jsonapi_prefix,
    cwd: process.cwd(),
    plugins: cfg.plugins,
  };
}
