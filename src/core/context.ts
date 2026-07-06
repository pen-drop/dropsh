import { ConfigError } from "../errors.js";
import type { AuthAdapter } from "./auth/types.js";
import { loadConfig } from "./config.js";
import type { HttpClient } from "./http.js";
import { createHttpClient } from "./http.js";
import { createJsonApiClient, type JsonApiClient } from "./jsonapi/client.js";
import type { DrupalCliPlugin } from "./plugin.js";

export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  plugins: DrupalCliPlugin[];
}

export async function createCommandContext(configPath: string): Promise<CommandContext> {
  const cfg = await loadConfig(configPath);
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const authPlugin = cfg.plugins.find((p) => p.createAuthAdapter);
  if (!authPlugin?.createAuthAdapter) {
    throw new ConfigError(
      "No auth plugin configured. Add basicAuthPlugin() or oauth2Plugin() to config.plugins.",
    );
  }
  const auth = authPlugin.createAuthAdapter();
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
