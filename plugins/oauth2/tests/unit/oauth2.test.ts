import type { HttpClient } from "dropsh/plugin";
import { AuthError } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { createOAuth2Auth } from "../../src/oauth2.js";

function httpMock(responses: Array<{ status: number; body: unknown }>): HttpClient {
  let i = 0;
  return {
    async send(_req) {
      const r = responses[i++];
      if (!r) throw new Error("unexpected call");
      if (r.status >= 200 && r.status < 300) {
        return { status: r.status, headers: {}, body: JSON.stringify(r.body) };
      }
      const { HttpError } = await import("../../../../src/errors.js");
      throw new HttpError(r.status, `HTTP ${r.status}`, r.body);
    },
  };
}

const BASE_TOKEN_URL = "https://example.com/oauth/token";

describe("oauth2 auth", () => {
  it("password grant: fetches token, applies Bearer header, reuses cached token", async () => {
    const http = httpMock([{ status: 200, body: { access_token: "tok1", expires_in: 3600 } }]);
    const sendSpy = vi.spyOn(http, "send");
    const adapter = createOAuth2Auth(
      {
        type: "oauth2_password",
        client_id: "cid",
        client_secret: "csec",
        username: "u",
        password: "p",
        token_url: BASE_TOKEN_URL,
      },
      { http, now: () => 0 },
    );
    const r1 = await adapter.apply({ method: "GET", url: "https://x/y" });
    expect(r1.headers?.Authorization).toBe("Bearer tok1");
    const r2 = await adapter.apply({ method: "GET", url: "https://x/z" });
    expect(r2.headers?.Authorization).toBe("Bearer tok1");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("password grant: refetches after expiry", async () => {
    const http = httpMock([
      { status: 200, body: { access_token: "tok1", expires_in: 60 } },
      { status: 200, body: { access_token: "tok2", expires_in: 60 } },
    ]);
    let t = 0;
    const adapter = createOAuth2Auth(
      {
        type: "oauth2_password",
        client_id: "c",
        client_secret: "s",
        username: "u",
        password: "p",
        token_url: BASE_TOKEN_URL,
      },
      { http, now: () => t },
    );
    const r1 = await adapter.apply({ method: "GET", url: "https://x" });
    expect(r1.headers?.Authorization).toBe("Bearer tok1");
    t = 120_000;
    const r2 = await adapter.apply({ method: "GET", url: "https://x" });
    expect(r2.headers?.Authorization).toBe("Bearer tok2");
  });

  it("client_credentials grant uses correct body", async () => {
    const http = httpMock([{ status: 200, body: { access_token: "cc", expires_in: 3600 } }]);
    const sendSpy = vi.spyOn(http, "send");
    const adapter = createOAuth2Auth(
      {
        type: "oauth2_client_credentials",
        client_id: "c",
        client_secret: "s",
        token_url: BASE_TOKEN_URL,
      },
      { http, now: () => 0 },
    );
    await adapter.apply({ method: "GET", url: "https://x" });
    const call = sendSpy.mock.calls[0]?.[0];
    expect(call?.url).toBe(BASE_TOKEN_URL);
    expect(call?.body).toContain("grant_type=client_credentials");
    expect(call?.body).toContain("client_id=c");
    expect(call?.body).toContain("client_secret=s");
    expect(call?.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("throws AuthError when token endpoint returns error", async () => {
    const http = httpMock([{ status: 401, body: { error: "invalid_grant" } }]);
    const adapter = createOAuth2Auth(
      {
        type: "oauth2_password",
        client_id: "c",
        client_secret: "s",
        username: "u",
        password: "p",
        token_url: BASE_TOKEN_URL,
      },
      { http, now: () => 0 },
    );
    await expect(adapter.apply({ method: "GET", url: "https://x" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
