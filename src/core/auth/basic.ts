import { ConfigError } from "../../errors.js";
import type { HttpRequest } from "../http.js";
import type { DropSHPlugin } from "../plugin.js";
import type { AuthAdapter } from "./types.js";

export interface BasicAuthConfig {
  username: string;
  password: string;
}

export function createBasicAuth(cfg: BasicAuthConfig): AuthAdapter {
  if (typeof cfg.username !== "string" || cfg.username.length === 0)
    throw new ConfigError("basicAuthPlugin: username required");
  if (typeof cfg.password !== "string" || cfg.password.length === 0)
    throw new ConfigError("basicAuthPlugin: password required");
  const token = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${token}` } };
    },
  };
}

export function basicAuthPlugin(config: BasicAuthConfig): DropSHPlugin {
  const adapter = createBasicAuth(config);
  return {
    id: "basic",
    requiredModules: [],
    createAuthAdapter: () => adapter,
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
