import { AuthError, HttpError } from "../../errors.js";
import type { AuthConfig } from "../config.js";
import type { HttpClient, HttpRequest } from "../http.js";
import { readToken, writeToken } from "./token-store.js";
import type { AuthAdapter } from "./types.js";

export interface OAuth2AuthCodeDeps {
  http: HttpClient;
  baseUrl: string;
  now?: () => number;
  tokenDir?: string;
}

function requireString(cfg: AuthConfig, key: string): string {
  const value = cfg[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthError(`${cfg.type} auth requires ${key}`);
  }
  return value;
}

export function createOAuth2AuthCodeAuth(cfg: AuthConfig, deps: OAuth2AuthCodeDeps): AuthAdapter {
  const now = deps.now ?? Date.now;
  const clientId = requireString(cfg, "client_id");
  const tokenUrl =
    typeof cfg.token_url === "string"
      ? cfg.token_url
      : `${deps.baseUrl.replace(/\/$/, "")}/oauth/token`;

  return {
    async apply(req: HttpRequest): Promise<HttpRequest> {
      const stored = await readToken(deps.baseUrl, deps.tokenDir);
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
          client_id: clientId,
        });
        const res = await deps.http.send({
          method: "POST",
          url: tokenUrl,
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
        await writeToken(deps.baseUrl, refreshed, deps.tokenDir);
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
