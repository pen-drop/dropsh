import { describe, expect, it } from "vitest";
import { basicAuthPlugin } from "../../../../src/core/auth/basic.js";
import { ConfigError } from "../../../../src/errors.js";

describe("basicAuthPlugin", () => {
  it("throws ConfigError when username is empty", () => {
    expect(() => basicAuthPlugin({ username: "", password: "pw" }))
      .toThrow(ConfigError);
  });

  it("throws ConfigError when password is empty", () => {
    expect(() => basicAuthPlugin({ username: "user", password: "" }))
      .toThrow(ConfigError);
  });

  it("returns a plugin with id 'basic'", () => {
    const p = basicAuthPlugin({ username: "u", password: "p" });
    expect(p.id).toBe("basic");
    expect(p.requiredModules).toEqual([]);
  });

  it("createAuthAdapter returns an adapter with correct Basic header", async () => {
    const p = basicAuthPlugin({ username: "alice", password: "s3cret" });
    const adapter = p.createAuthAdapter!();
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe(
      `Basic ${Buffer.from("alice:s3cret").toString("base64")}`,
    );
  });

  it("preserves existing headers", async () => {
    const p = basicAuthPlugin({ username: "u", password: "p" });
    const adapter = p.createAuthAdapter!();
    const req = await adapter.apply({ method: "GET", url: "https://x", headers: { "X-Foo": "bar" } });
    expect(req.headers?.["X-Foo"]).toBe("bar");
  });

  it("extendSchema returns schema unchanged", async () => {
    const p = basicAuthPlugin({ username: "u", password: "p" });
    const schema = { type: "object" };
    expect(await p.extendSchema("node", "article", schema, {} as any)).toBe(schema);
  });
});
