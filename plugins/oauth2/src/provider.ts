import type {
  AdapterRuntime,
  AuthAdapter,
  AuthContext,
  AuthProvider,
  AuthSession,
  HttpClient,
} from "dropsh/plugin";
import { AuthError, HttpError } from "dropsh/plugin";
import type { OAuth2Config } from "./index.js";
import { acquireAuthCodeSession } from "./login.js";

const DISPLAY: Record<OAuth2Config["type"], string> = {
  oauth2_authcode: "OAuth 2.0 (browser login, PKCE)",
  oauth2_password: "OAuth 2.0 (resource owner password)",
  oauth2_client_credentials: "OAuth 2.0 (client credentials)",
};

function bearer(req: { headers?: Record<string, string> }, token: string): Record<string, string> {
  return { ...(req.headers ?? {}), Authorization: `Bearer ${token}` };
}

async function postToken(
  http: HttpClient,
  url: string,
  params: URLSearchParams,
  now: () => number,
): Promise<AuthSession> {
  try {
    const res = await http.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = JSON.parse(res.body) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof body.access_token !== "string")
      throw new AuthError("Token endpoint returned no access_token");
    const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      access_token: body.access_token,
      ...(typeof body.refresh_token === "string" ? { refresh_token: body.refresh_token } : {}),
      expires_at: now() + ttlSec * 1000 - 5000,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof HttpError)
      throw new AuthError(`Token request failed: HTTP ${err.status}`, { body: err.body });
    throw new AuthError(`Token request failed: ${(err as Error).message}`);
  }
}

export function oauth2Provider(cfg: OAuth2Config): AuthProvider {
  return {
    id: cfg.type,
    displayName: DISPLAY[cfg.type],
    capabilities: { login: true, logout: true, status: true },

    async login(ctx: AuthContext): Promise<AuthSession> {
      if (cfg.type === "oauth2_authcode") {
        return acquireAuthCodeSession({
          baseUrl: ctx.baseUrl,
          clientId: cfg.client_id,
          tokenUrl: cfg.token_url,
          ...(cfg.scope !== undefined ? { scope: cfg.scope } : {}),
          ...(cfg.redirect_port !== undefined ? { redirectPort: cfg.redirect_port } : {}),
          http: ctx.http,
          openBrowser: ctx.openBrowser,
          stdout: ctx.stdout,
          now: ctx.now,
        });
      }
      const params = new URLSearchParams({ client_id: cfg.client_id });
      const secret = await ctx.prompt({ label: "Client secret", secret: true });
      params.set("client_secret", secret);
      if (cfg.type === "oauth2_password") {
        const password = await ctx.prompt({ label: "Password", secret: true });
        params.set("grant_type", "password");
        params.set("username", cfg.username);
        params.set("password", password);
      } else {
        params.set("grant_type", "client_credentials");
      }
      if (cfg.scope) params.set("scope", cfg.scope);
      return postToken(ctx.http, cfg.token_url, params, ctx.now);
    },

    async logout() {
      // simple_oauth has no standard revoke endpoint wired; core clears the session.
    },

    async status(session) {
      if (!session) return { loggedIn: false, provider: cfg.type };
      const expiresAt = typeof session.expires_at === "number" ? session.expires_at : undefined;
      const info: {
        loggedIn: boolean;
        provider: string;
        expiresAt?: number;
        state?: "valid" | "expired";
      } = {
        loggedIn: true,
        provider: cfg.type,
      };
      if (expiresAt !== undefined) {
        info.expiresAt = expiresAt;
        info.state = expiresAt > Date.now() ? "valid" : "expired";
      }
      return info;
    },

    createAdapter(session: AuthSession, rt: AdapterRuntime): AuthAdapter {
      // Mutable reference to the live session, updated in place after a refresh
      // so subsequent requests reuse the new token instead of re-refreshing.
      let current = session;
      let refreshing: Promise<void> | null = null;

      async function doRefresh(refreshToken: string): Promise<void> {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: cfg.client_id,
        });
        const refreshed = await postToken(rt.http, cfg.token_url, params, rt.now);
        if (typeof refreshed.refresh_token !== "string") refreshed.refresh_token = refreshToken;
        current = refreshed;
        await rt.save(refreshed);
      }

      return {
        async apply(req) {
          const token = current.access_token;
          const expiresAt = typeof current.expires_at === "number" ? current.expires_at : 0;
          if (typeof token === "string" && expiresAt - 30_000 > rt.now())
            return { ...req, headers: bearer(req, token) };
          const refresh = current.refresh_token;
          if (typeof refresh !== "string")
            throw new AuthError("Session expired. Run 'dropsh auth login'.");
          // Coalesce concurrent refreshes so we exchange the token only once.
          if (!refreshing)
            refreshing = doRefresh(refresh).finally(() => {
              refreshing = null;
            });
          await refreshing;
          return { ...req, headers: bearer(req, current.access_token as string) };
        },
      };
    },
  };
}
