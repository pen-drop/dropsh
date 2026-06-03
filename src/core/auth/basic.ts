import { ConfigError } from "../../errors.js";
import type { HttpRequest } from "../http.js";
import type { DropSHPlugin } from "../plugin.js";
import type { AuthAdapter, AuthProvider, AuthSession } from "./types.js";

export interface BasicAuthConfig {
  /** Optional pre-seeded username; password is always prompted at login. */
  username?: string;
}

function adapterFromB64(b64: string): AuthAdapter {
  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${b64}` } };
    },
  };
}

export function basicAuthProvider(config: BasicAuthConfig = {}): AuthProvider {
  return {
    id: "basic",
    displayName: "Basic auth (username / password)",
    capabilities: { login: true, logout: true, status: true },
    async login(ctx): Promise<AuthSession> {
      const username = config.username ?? (await ctx.prompt({ label: "Username" }));
      if (!username) throw new ConfigError("basic auth: username required");
      const password = await ctx.prompt({ label: "Password", secret: true });
      if (!password) throw new ConfigError("basic auth: password required");
      return { basic_b64: Buffer.from(`${username}:${password}`).toString("base64") };
    },
    async logout() {
      // No server-side revoke for basic auth; the core clears the session.
    },
    async status(session) {
      return { loggedIn: session !== null, provider: "basic" };
    },
    createAdapter(session): AuthAdapter {
      const b64 = session.basic_b64;
      if (typeof b64 !== "string") throw new ConfigError("basic auth: corrupt session");
      return adapterFromB64(b64);
    },
  };
}

export function basicAuthPlugin(config: BasicAuthConfig = {}): DropSHPlugin {
  return {
    id: "basic",
    requiredModules: [],
    authProvider: basicAuthProvider(config),
    async extendSchema(_entityType, _bundle, schema, _ctx) {
      return schema;
    },
  };
}
