import { describe, expect, it } from "vitest";
import { basicAuthPlugin } from "../../../../src/core/auth/basic.js";
import type { AuthContext } from "../../../../src/core/auth/types.js";

function fakeCtx(answers: Record<string, string>): AuthContext {
  return {
    baseUrl: "https://example.com",
    http: { async send() { throw new Error("unused"); } },
    async prompt({ label }) { return answers[label] ?? ""; },
    async openBrowser() {},
    stdout() {},
    now() { return 0; },
  };
}

describe("basic auth provider", () => {
  it("login prompts username + password and yields a base64 session", async () => {
    const provider = basicAuthPlugin().authProvider!;
    const session = await provider.login(fakeCtx({ Username: "admin", Password: "secret" }));
    expect(session).toEqual({ basic_b64: Buffer.from("admin:secret").toString("base64") });
  });

  it("createAdapter applies the Authorization header", async () => {
    const provider = basicAuthPlugin().authProvider!;
    const b64 = Buffer.from("u:p").toString("base64");
    const adapter = provider.createAdapter({ basic_b64: b64 }, {
      http: { async send() { throw new Error("unused"); } },
      now: () => 0,
      async save() {},
    });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe(`Basic ${b64}`);
  });

  it("status reports loggedIn based on the session presence", async () => {
    const provider = basicAuthPlugin().authProvider!;
    expect((await provider.status(null)).loggedIn).toBe(false);
    expect((await provider.status({ basic_b64: "x" })).loggedIn).toBe(true);
  });
});
