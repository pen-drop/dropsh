import { AuthError, HttpError } from "../../errors.js";
import type { AuthConfig } from "../config.js";
import type { HttpClient, HttpRequest } from "../http.js";
import type { AuthAdapter } from "./types.js";

export interface OAuth2Deps {
  http: HttpClient;
  baseUrl: string;
  now?: () => number;
}

function requireString(cfg: AuthConfig, key: string): string {
  const v = cfg[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new AuthError(`${cfg.type} auth requires ${key}`);
  }
  return v;
}

export function createOAuth2Auth(cfg: AuthConfig, deps: OAuth2Deps): AuthAdapter {
  const now = deps.now ?? Date.now;
  const clientId = requireString(cfg, "client_id");
  const clientSecret = requireString(cfg, "client_secret");
  const tokenUrl =
    typeof cfg.token_url === "string"
      ? cfg.token_url
      : `${deps.baseUrl.replace(/\/$/, "")}/oauth/token`;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (cfg.type === "oauth2_password") {
    params.set("grant_type", "password");
    params.set("username", requireString(cfg, "username"));
    params.set("password", requireString(cfg, "password"));
    if (typeof cfg.scope === "string") params.set("scope", cfg.scope);
  } else if (cfg.type === "oauth2_client_credentials") {
    params.set("grant_type", "client_credentials");
    if (typeof cfg.scope === "string") params.set("scope", cfg.scope);
  } else {
    throw new AuthError(`Unsupported oauth2 grant: ${cfg.type}`);
  }

  let cached: { token: string; expiresAt: number } | null = null;

  async function fetchToken(): Promise<{ token: string; expiresAt: number }> {
    try {
      const res = await deps.http.send({
        method: "POST",
        url: tokenUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const body = JSON.parse(res.body) as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== "string") {
        throw new AuthError("Token endpoint returned no access_token");
      }
      const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
      return { token: body.access_token, expiresAt: now() + ttlSec * 1000 - 5000 };
    } catch (err) {
      if (err instanceof HttpError)
        throw new AuthError(`Token request failed: HTTP ${err.status}`, { body: err.body });
      if (err instanceof AuthError) throw err;
      throw new AuthError(`Token request failed: ${(err as Error).message}`);
    }
  }

  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      if (!cached || cached.expiresAt <= now()) cached = await fetchToken();
      return {
        ...req,
        headers: { ...(req.headers ?? {}), Authorization: `Bearer ${cached.token}` },
      };
    },
  };
}
