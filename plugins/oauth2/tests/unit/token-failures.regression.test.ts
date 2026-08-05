// Regression suite for DROPSH-14 — oauth2 token failures must name their cause.
//
// Three defects on one auth path, each mapped to acceptance criteria (AC):
//   * A missing/empty client_secret is a config error, not an expired session
//     (AC1, AC2, AC3, AC10).
//   * A server-rejected token request names the inputs it used and interprets
//     the RFC 6749 `error` code, without leaking the secret (AC4-AC7).
//   * A valid stored token is used untouched (AC8).
//   * A failing reactive-401 renewal carries its cause to the caller (AC9).
//
// Authored RED in the `diagnose` step: every assertion below describes the
// desired behaviour and therefore fails against the current provider. The
// `coding` step drives them GREEN. Run with:
//   pnpm --filter @dropsh/plugin-oauth2 test

import {
  type AuthContext,
  AuthError,
  createJsonApiClient,
  type HttpClient,
  HttpError,
} from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { oauth2Plugin } from "../../src/index.js";

const NOW = 1_000_000;

/** A caught CliError-shaped value: both AuthError and HttpError carry `details`. */
type CaughtError = { message?: string; details?: Record<string, unknown> };

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return {
    baseUrl: "https://example.com",
    http: {
      async send() {
        throw new Error("unused");
      },
    },
    async prompt() {
      return "";
    },
    async openBrowser() {},
    stdout() {},
    now() {
      return NOW;
    },
    ...over,
  };
}

/** Token endpoint that rejects like the real http client does: throws HttpError. */
const rejectingHttp = (status: number, body: unknown): HttpClient => ({
  async send() {
    throw new HttpError(status, `HTTP ${status}`, body);
  },
});

const okTokenHttp = (body: object): HttpClient => ({
  async send() {
    return { status: 200, headers: {}, body: JSON.stringify(body) };
  },
});

describe("DROPSH-14 · a missing client_secret is a config error, not an expired session", () => {
  it("proactive renewal with an unset secret names the config error and sends no token request", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    const provider = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "stale", expires_at: 1 }, // proactively expired
      { http: { send }, now: () => NOW, async save() {} },
    );

    const err = (await adapter
      .apply({ method: "GET", url: "/x", headers: {} })
      .catch((e) => e)) as CaughtError;

    expect(err).toBeInstanceOf(AuthError);
    expect(err.details?.reason).toBe("secret_not_configured"); // AC6 discriminator
    expect(err.message).toContain("pm"); // AC1 names the profile id
    expect(err.message).toContain("client_secret"); // AC1 names the config field
    expect(err.message).not.toContain("auth login"); // AC3 no login advice
    expect(send).not.toHaveBeenCalled(); // AC2 no token request sent
  });

  it("login with an empty client_secret fails before sending, never posting an empty secret", async () => {
    const send = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ access_token: "tok", expires_in: 3600 }),
    }));
    const provider = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      client_secret: "",
    }).authProvider!;

    const err = (await provider.login(ctx({ http: { send } })).catch((e) => e)) as CaughtError;

    expect(err).toBeInstanceOf(AuthError);
    expect(err.details?.reason).toBe("secret_not_configured");
    expect(send).not.toHaveBeenCalled(); // AC2 no empty client_secret is ever sent
  });

  it("login does not prompt for the secret; a missing secret fails with the config message", async () => {
    const prompt = vi.fn(async () => {
      throw new Error("prompt should not be called");
    });
    const provider = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;

    const err = (await provider
      .login(ctx({ prompt, http: okTokenHttp({ access_token: "t" }) }))
      .catch((e) => e)) as CaughtError;

    expect(err).toBeInstanceOf(AuthError);
    expect(err.details?.reason).toBe("secret_not_configured"); // AC10 fails, not prompts
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe("DROPSH-14 · a rejected token request names its inputs and interprets RFC 6749", () => {
  it("an invalid_client verdict is claimed only when the server returned it, and hides the secret", async () => {
    const provider = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      scope: "gaia:pm",
      client_secret: "topsecret",
    }).authProvider!;
    const http = rejectingHttp(401, {
      error: "invalid_client",
      error_description: "Client authentication failed",
    });

    const err = (await provider.login(ctx({ http })).catch((e) => e)) as CaughtError;

    expect(err).toBeInstanceOf(AuthError);
    expect(err.details?.reason).toBe("invalid_client"); // AC5
    expect(err.details?.profile).toBe("pm"); // AC6 machine-readable inputs
    expect(err.details?.client_id).toBe("cid");
    expect(err.details?.scope).toBe("gaia:pm");
    expect(err.details?.token_endpoint).toBe("https://example.com/oauth/token");
    for (const named of ["pm", "cid", "gaia:pm", "https://example.com/oauth/token"]) {
      expect(err.message).toContain(named); // AC4 names profile/client_id/scope/endpoint
    }
    expect(err.message).not.toContain("topsecret"); // AC7 no secret in the message
    expect(JSON.stringify(err.details)).not.toContain("topsecret"); // AC7 no secret in details
  });

  it("a 401 without invalid_client yields a generic credentials-rejected verdict", async () => {
    const provider = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      client_secret: "topsecret",
    }).authProvider!;
    const http = rejectingHttp(401, { error: "invalid_grant" });

    const err = (await provider.login(ctx({ http })).catch((e) => e)) as CaughtError;

    expect(err).toBeInstanceOf(AuthError);
    expect(err.details?.reason).toBe("credentials_rejected"); // AC5
    expect((err.message ?? "").toLowerCase()).not.toContain("invalid_client");
    expect(JSON.stringify(err.details)).not.toContain("topsecret"); // AC7
  });
});

describe("DROPSH-14 · a valid stored token is used untouched", () => {
  it("apply() with a valid token sends no token request and needs no configured secret", async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      // no client_secret configured
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "good", expires_at: NOW + 3_600_000 },
      { http: { send }, now: () => NOW, async save() {} },
    );

    const req = await adapter.apply({ method: "GET", url: "/x", headers: {} });

    expect(req.headers?.Authorization).toBe("Bearer good"); // AC8
    expect(send).not.toHaveBeenCalled();
  });
});

describe("DROPSH-14 · a failing reactive-401 renewal carries its cause", () => {
  it("the caller sees the renewal failure cause, not only the original 401", async () => {
    const provider = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      // no secret → the reactive renewal cannot succeed
    }).authProvider!;
    // The token is valid for apply() (far-future expiry) so the request is
    // actually sent; the *server* then rejects it with 401, driving renew().
    const jsonapiHttp: HttpClient = {
      async send() {
        throw new HttpError(401, "HTTP 401", { errors: [{ status: "401" }] });
      },
    };
    const adapter = provider.createAdapter(
      { access_token: "tok", expires_at: NOW + 3_600_000 },
      { http: jsonapiHttp, now: () => NOW, async save() {} },
    );
    const client = createJsonApiClient({
      baseUrl: "https://example.com",
      prefix: "/jsonapi",
      http: jsonapiHttp,
      auth: adapter,
    });

    const err = (await client.get("node/article").catch((e) => e)) as CaughtError;

    // AC9: the renewal failed because the secret is not configured — that cause
    // must reach the caller instead of a bare, unexplained 401.
    const serialized = `${err.message ?? ""} ${JSON.stringify(err.details ?? {})}`;
    expect(serialized).toContain("secret_not_configured");
  });
});
