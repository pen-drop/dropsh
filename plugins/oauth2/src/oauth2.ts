import type { AuthAdapter, HttpClient, HttpRequest } from "dropsh/plugin";
import { AuthError, createHttpClient, HttpError } from "dropsh/plugin";

export type OAuth2GrantConfig =
  | {
      type: "oauth2_password";
      client_id: string;
      client_secret: string;
      username: string;
      password: string;
      token_url: string;
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      client_id: string;
      client_secret: string;
      token_url: string;
      scope?: string;
    };

export interface OAuth2TestDeps {
  http?: HttpClient;
  now?: () => number;
}

export function createOAuth2Auth(cfg: OAuth2GrantConfig, deps: OAuth2TestDeps = {}): AuthAdapter {
  const now = deps.now ?? Date.now;
  const http = deps.http ?? createHttpClient();

  const params = new URLSearchParams({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
  });
  if (cfg.type === "oauth2_password") {
    params.set("grant_type", "password");
    params.set("username", cfg.username);
    params.set("password", cfg.password);
    if (cfg.scope) params.set("scope", cfg.scope);
  } else {
    params.set("grant_type", "client_credentials");
    if (cfg.scope) params.set("scope", cfg.scope);
  }

  let cached: { token: string; expiresAt: number } | null = null;

  async function fetchToken(): Promise<{ token: string; expiresAt: number }> {
    try {
      const res = await http.send({
        method: "POST",
        url: cfg.token_url,
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
      if (err instanceof HttpError) {
        throw new AuthError(`Token request failed: HTTP ${err.status}`, { body: err.body });
      }
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
