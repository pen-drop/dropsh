import { describe, expect, it } from "vitest";
import { createBasicAuth } from "../../../../src/core/auth/basic.js";
import { AuthError } from "../../../../src/errors.js";

describe("basic auth", () => {
  it("adds Basic Authorization header", async () => {
    const adapter = createBasicAuth({ type: "basic", username: "alice", password: "s3cret" });
    const req = await adapter.apply({ method: "GET", url: "https://x/y" });
    expect(req.headers?.Authorization).toBe("Basic " + Buffer.from("alice:s3cret").toString("base64"));
  });

  it("preserves existing headers", async () => {
    const adapter = createBasicAuth({ type: "basic", username: "a", password: "b" });
    const req = await adapter.apply({ method: "GET", url: "https://x", headers: { "X-Foo": "1" } });
    expect(req.headers?.["X-Foo"]).toBe("1");
  });

  it("throws AuthError if username missing", () => {
    expect(() => createBasicAuth({ type: "basic", password: "x" } as any)).toThrow(AuthError);
  });
});
