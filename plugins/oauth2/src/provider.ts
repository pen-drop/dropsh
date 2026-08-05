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

/**
 * The safe, non-secret identity of a token request: the profile and endpoint it
 * targeted. Threaded into {@link postToken} so a server rejection can name the
 * inputs it used — never the client secret or the request body.
 */
interface TokenRequestIdentity {
  profile: string;
  client_id: string;
  scope?: string;
  token_endpoint: string;
}

/**
 * Read the RFC 6749 `error` code from a token endpoint's error response. The
 * body may already be an object (as our tests and some clients provide) or the
 * raw JSON string the real http client carries; parse defensively and return
 * the `error` field only when it is a string.
 */
function readOAuthError(body: unknown): string | undefined {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const code = (parsed as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  return undefined;
}

async function postToken(
  http: HttpClient,
  url: string,
  params: URLSearchParams,
  now: () => number,
  identity: TokenRequestIdentity,
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
    if (err instanceof HttpError) {
      // Interpret RFC 6749: only claim `invalid_client` when the server said so;
      // everything else (a bare 401/403, another code, or no code) is the
      // generic `credentials_rejected`. Name the inputs used, never the secret.
      const oauthError = readOAuthError(err.body);
      const reason = oauthError === "invalid_client" ? "invalid_client" : "credentials_rejected";
      const scopePart = identity.scope !== undefined ? `, scope "${identity.scope}"` : "";
      throw new AuthError(
        `OAuth2 token request rejected for profile "${identity.profile}" ` +
          `(client_id "${identity.client_id}"${scopePart}) at ${identity.token_endpoint}: ${reason}.`,
        {
          reason,
          profile: identity.profile,
          client_id: identity.client_id,
          ...(identity.scope !== undefined ? { scope: identity.scope } : {}),
          token_endpoint: identity.token_endpoint,
        },
      );
    }
    throw new AuthError(`Token request failed: ${(err as Error).message}`);
  }
}

export function oauth2Provider(cfg: OAuth2Config): AuthProvider {
  // Profile identity is `cfg.id` (falling back to `cfg.type`); `cfg.type` stays
  // purely the grant-flow selector used by login/renew/status below.
  const id = cfg.id ?? cfg.type;

  // The non-secret identity every token request carries, so a rejection can name
  // the inputs it used without ever echoing the client secret.
  const identity: TokenRequestIdentity = {
    profile: id,
    client_id: cfg.client_id,
    ...(cfg.scope !== undefined ? { scope: cfg.scope } : {}),
    token_endpoint: cfg.token_url,
  };

  // A non-authcode grant needs a configured client_secret. An unset OR empty
  // secret is a config error — not an expired session and not a prompt — so it
  // fails BEFORE any token request (no empty secret is ever posted).
  function requireClientSecret(): string {
    const secret =
      cfg.type === "oauth2_client_credentials" || cfg.type === "oauth2_password"
        ? cfg.client_secret
        : undefined;
    if (typeof secret !== "string" || secret.length === 0) {
      throw new AuthError(
        `OAuth2 profile "${id}" has no client_secret configured; ` +
          `set plugins[].with.client_secret for this profile.`,
        {
          reason: "secret_not_configured",
          profile: id,
          client_id: cfg.client_id,
          ...(cfg.scope !== undefined ? { scope: cfg.scope } : {}),
          token_endpoint: cfg.token_url,
        },
      );
    }
    return secret;
  }

  return {
    id,
    displayName: cfg.id ? `${DISPLAY[cfg.type]} [${cfg.id}]` : DISPLAY[cfg.type],
    default: cfg.default === true,
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
      // The client_secret is config, not a runtime credential: require it up
      // front (throws before any token request if unset/empty) rather than
      // prompting for it or posting an empty secret.
      const secret = requireClientSecret();
      const params = new URLSearchParams({ client_id: cfg.client_id, client_secret: secret });
      if (cfg.type === "oauth2_password") {
        // The user's password *is* a runtime credential, so it is still prompted.
        const password = await ctx.prompt({ label: "Password", secret: true });
        params.set("grant_type", "password");
        params.set("username", cfg.username);
        params.set("password", password);
      } else {
        params.set("grant_type", "client_credentials");
      }
      if (cfg.scope) params.set("scope", cfg.scope);
      return postToken(ctx.http, cfg.token_url, params, ctx.now, identity);
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
      // Mutable reference to the live session, updated in place after a renewal
      // so subsequent requests reuse the new token instead of renewing again.
      let current = session;
      let inflight: Promise<void> | null = null;

      async function refreshAuthcode(refreshToken: string): Promise<void> {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: cfg.client_id,
        });
        const refreshed = await postToken(rt.http, cfg.token_url, params, rt.now, identity);
        if (typeof refreshed.refresh_token !== "string") refreshed.refresh_token = refreshToken;
        current = refreshed;
        await rt.save(refreshed);
      }

      // client_credentials is idempotent: re-mint from client_id + secret, no
      // refresh_token needed. The secret is config-provided and kept in memory
      // only — never written to the persisted session (rt.save stores the token).
      async function mintClientCredentials(secret: string): Promise<void> {
        const params = new URLSearchParams({
          grant_type: "client_credentials",
          client_id: cfg.client_id,
          client_secret: secret,
        });
        if (cfg.scope) params.set("scope", cfg.scope);
        const minted = await postToken(rt.http, cfg.token_url, params, rt.now, identity);
        current = minted;
        await rt.save(minted);
      }

      async function renewSession(): Promise<void> {
        if (cfg.type === "oauth2_authcode") {
          const refresh = current.refresh_token;
          if (typeof refresh !== "string")
            throw new AuthError("Session expired. Run 'dropsh auth login'.");
          await refreshAuthcode(refresh);
          return;
        }
        if (cfg.type === "oauth2_client_credentials") {
          // A missing/empty secret here is a config error (surfaced by the
          // guard), not a genuinely expired session.
          await mintClientCredentials(requireClientSecret());
          return;
        }
        // password grant: no silent re-mint is possible (it needs the user's
        // password), so a genuinely expired session must be re-established by login.
        throw new AuthError("Session expired. Run 'dropsh auth login'.");
      }

      // Coalesce concurrent renewals so we hit the token endpoint once.
      function coalescedRenew(): Promise<void> {
        if (!inflight)
          inflight = renewSession().finally(() => {
            inflight = null;
          });
        return inflight;
      }

      return {
        async apply(req) {
          const token = current.access_token;
          const expiresAt = typeof current.expires_at === "number" ? current.expires_at : 0;
          if (typeof token === "string" && expiresAt - 30_000 > rt.now())
            return { ...req, headers: bearer(req, token) };
          await coalescedRenew();
          return { ...req, headers: bearer(req, current.access_token as string) };
        },
        // Reactive path: the server rejected the token (401). Try once to re-mint /
        // refresh from the credentials we have; report whether the caller may retry
        // and, on failure, carry the cause so the caller can surface *why*.
        async renew() {
          try {
            await coalescedRenew();
            return { ok: true };
          } catch (cause) {
            return { ok: false, cause };
          }
        },
      };
    },
  };
}
