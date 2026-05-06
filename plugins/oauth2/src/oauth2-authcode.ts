import type { AuthAdapter, HttpClient, HttpRequest } from "drupal-cli/plugin";
import { AuthError, createHttpClient, HttpError } from "drupal-cli/plugin";
import { readToken, writeToken } from "./token-store.js";

export type AuthCodeConfig = {
  type: "oauth2_authcode";
  client_id: string;
  token_url: string;
  scope?: string;
  redirect_port?: number;
};

export interface OAuth2AuthCodeTestDeps {
  http?: HttpClient;
  now?: () => number;
  tokenDir?: string;
}

export function createOAuth2AuthCodeAuth(
  cfg: AuthCodeConfig,
  deps: OAuth2AuthCodeTestDeps = {},
): AuthAdapter {
  const now = deps.now ?? Date.now;
  const http = deps.http ?? createHttpClient();
  // Derive base URL for token storage key
  const baseUrl = cfg.token_url.replace(/\/oauth\/token$/, "");

  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      const stored = await readToken(baseUrl, deps.tokenDir);
      if (!stored) {
        throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.");
      }

      if (stored.expires_at - 30_000 > now()) {
        return {
          ...req,
          headers: { ...(req.headers ?? {}), Authorization: `Bearer ${stored.access_token}` },
        };
      }

      if (!stored.refresh_token) {
        throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.");
      }

      try {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: stored.refresh_token,
          client_id: cfg.client_id,
        });
        const res = await http.send({
          method: "POST",
          url: cfg.token_url,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const body = JSON.parse(res.body) as {
          access_token?: unknown;
          refresh_token?: unknown;
          expires_in?: unknown;
        };
        if (typeof body.access_token !== "string") {
          throw new AuthError("Token endpoint returned no access_token");
        }
        const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
        const refreshed = {
          access_token: body.access_token,
          refresh_token:
            typeof body.refresh_token === "string" ? body.refresh_token : stored.refresh_token,
          expires_at: now() + ttlSec * 1000 - 5000,
        };
        await writeToken(baseUrl, refreshed, deps.tokenDir);
        return {
          ...req,
          headers: { ...(req.headers ?? {}), Authorization: `Bearer ${refreshed.access_token}` },
        };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        if (err instanceof HttpError) {
          throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.", {
            status: err.status,
            body: err.body,
          });
        }
        throw new AuthError("Session expired. Run 'drupal-cli login' to authenticate.");
      }
    },
  };
}
