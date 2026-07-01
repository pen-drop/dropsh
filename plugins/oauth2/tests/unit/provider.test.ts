import type { AuthContext, HttpClient, HttpRequest } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { oauth2Plugin } from "../../src/index.js";

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
      return 1_000_000;
    },
    ...over,
  };
}

const tokenHttp = (body: object): HttpClient => ({
  async send() {
    return { status: 200, headers: {}, body: JSON.stringify(body) };
  },
});

describe("oauth2 provider — client_credentials", () => {
  it("login prompts client_secret and returns a token session", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const prompt = vi.fn(async () => "the-secret");
    const session = await provider.login(
      ctx({ prompt, http: tokenHttp({ access_token: "tok", expires_in: 3600 }) }),
    );
    expect(prompt).toHaveBeenCalledWith({ label: "Client secret", secret: true });
    expect(session.access_token).toBe("tok");
    expect(session.expires_at).toBe(1_000_000 + 3600 * 1000 - 5000);
  });

  it("createAdapter sets a Bearer header from the session", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "tok", expires_at: 2_000_000 },
      { http: tokenHttp({}), now: () => 1_000_000, async save() {} },
    );
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe("Bearer tok");
  });
});

describe("oauth2 provider — refresh", () => {
  it("client_credentials with an expired session does not refresh, rejects with AuthError", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    const adapter = provider.createAdapter(
      { access_token: "tok", refresh_token: "rt", expires_at: 1 },
      { http: { send }, now: () => 1_000_000, async save() {} },
    );
    await expect(adapter.apply({ method: "GET", url: "https://x" })).rejects.toBeInstanceOf(
      AuthError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("authcode with an expired session refreshes and persists the new token", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_authcode",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const save = vi.fn(async (_session: { access_token: string }) => {});
    const adapter = provider.createAdapter(
      { access_token: "old", refresh_token: "rt", expires_at: 1 },
      {
        http: tokenHttp({ access_token: "fresh", expires_in: 3600 }),
        now: () => 1_000_000,
        save,
      },
    );
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe("Bearer fresh");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]?.access_token).toBe("fresh");
  });
});

describe("oauth2 provider — client_credentials headless", () => {
  it("login uses cfg.client_secret without prompting", async () => {
    const send = vi.fn(async (_req: HttpRequest) => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ access_token: "tok", expires_in: 3600 }),
    }));
    const prompt = vi.fn(async () => {
      throw new Error("should not prompt");
    });
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/token",
      client_secret: "shh",
    }).authProvider!;
    const session = await provider.login(
      ctx({ http: { send }, prompt }),
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(session.access_token).toBe("tok");
    const body = send.mock.calls[0]?.[0]?.body ?? "";
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_secret=shh");
  });

  it("createAdapter re-mints on expiry from client_secret", async () => {
    const send = vi.fn(async (_req: HttpRequest) => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ access_token: "fresh", expires_in: 3600 }),
    }));
    const saved: unknown[] = [];
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/token",
      client_secret: "shh",
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "stale", expires_at: 0 },
      { http: { send }, now: () => 1_000_000, save: async (s) => { saved.push(s); } },
    );
    const out = await adapter.apply({ method: "GET", url: "/x", headers: {} });
    expect(out.headers?.Authorization).toBe("Bearer fresh");
    expect(saved).toHaveLength(1);
    const body = send.mock.calls[0]?.[0]?.body ?? "";
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_secret=shh");
  });

  it("createAdapter without client_secret still throws on expiry", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/token",
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "stale", expires_at: 0 },
      { http: { send: vi.fn() }, now: () => 1_000_000, async save() {} },
    );
    await expect(adapter.apply({ method: "GET", url: "/x", headers: {} })).rejects.toThrow(
      "Session expired",
    );
  });
});

describe("oauth2 provider — status", () => {
  it("reports expired when expires_at is in the past", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const info = await provider.status({ access_token: "t", expires_at: 5 });
    expect(info.loggedIn).toBe(true);
    expect(info.state).toBe("expired");
  });
});

describe("oauth2 provider — profile identity (id decoupled from type)", () => {
  it("defaults id to type when no id is given (backward compatible)", () => {
    const p = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    expect(p.id).toBe("oauth2_client_credentials");
    expect(p.default).toBe(false);
  });

  it("uses an explicit id and annotates the display name", () => {
    const p = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    expect(p.id).toBe("pm");
    expect(p.displayName).toContain("[pm]");
  });

  it("two client_credentials profiles get distinct ids", () => {
    const a = oauth2Plugin({
      id: "session",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      scope: "gaia:session",
    }).authProvider!;
    const b = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
      scope: "gaia:project_manager",
    }).authProvider!;
    expect(a.id).not.toBe(b.id);
  });

  it("propagates default:true", () => {
    const p = oauth2Plugin({
      id: "session",
      default: true,
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    expect(p.default).toBe(true);
  });
});

describe("oauth2 adapter — reactive renew()", () => {
  it("client_credentials re-mints and reports renewed=true when a secret is configured", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      client_secret: "sec",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const saved: unknown[] = [];
    const adapter = provider.createAdapter(
      { access_token: "old", expires_at: 5 },
      {
        http: tokenHttp({ access_token: "new", expires_in: 3600 }),
        now: () => 1_000_000,
        async save(s) { saved.push(s); },
      },
    );
    expect(await adapter.renew!()).toBe(true);
    // The freshly minted token is applied and persisted.
    const req = await adapter.apply({ method: "GET", url: "/x", headers: {} });
    expect(req.headers?.Authorization).toBe("Bearer new");
    expect(saved).toHaveLength(1);
  });

  it("reports renewed=false when it cannot renew (no secret, no refresh_token)", async () => {
    const provider = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "cid",
      token_url: "https://example.com/oauth/token",
    }).authProvider!;
    const adapter = provider.createAdapter(
      { access_token: "old", expires_at: 5 },
      { http: tokenHttp({ access_token: "x" }), now: () => 1_000_000, async save() {} },
    );
    expect(await adapter.renew!()).toBe(false);
  });
});
