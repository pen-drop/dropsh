import { describe, expect, it } from "vitest";
import { createAuthAdapter } from "../../../../src/core/auth/factory.js";
import { AuthError } from "../../../../src/errors.js";
import type { HttpClient } from "../../../../src/core/http.js";

const http: HttpClient = { send: async () => ({ status: 200, headers: {}, body: "{}" }) };

describe("auth factory", () => {
  it("creates basic adapter", async () => {
    const a = createAuthAdapter({ type: "basic", username: "u", password: "p" }, { http, baseUrl: "https://x" });
    const req = await a.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toMatch(/^Basic /);
  });

  it("creates oauth2 adapter", () => {
    const a = createAuthAdapter(
      { type: "oauth2_client_credentials", client_id: "c", client_secret: "s" },
      { http, baseUrl: "https://x" },
    );
    expect(a.apply).toBeTypeOf("function");
  });

  it("creates oauth2_authcode adapter", () => {
    const a = createAuthAdapter(
      { type: "oauth2_authcode", client_id: "cid" },
      { http, baseUrl: "https://x" },
    );
    expect(a.apply).toBeTypeOf("function");
  });

  it("throws on unknown type", () => {
    expect(() => createAuthAdapter({ type: "weird" } as any, { http, baseUrl: "https://x" })).toThrow(AuthError);
  });
});
