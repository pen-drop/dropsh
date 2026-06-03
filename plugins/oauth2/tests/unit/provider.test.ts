import type { AuthContext, HttpClient } from "dropsh/plugin";
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
