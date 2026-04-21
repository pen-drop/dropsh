import { describe, expect, it } from "vitest";
import { createApiKeyAuth } from "../../../../src/core/auth/api-key.js";
import { AuthError } from "../../../../src/errors.js";

describe("api-key auth", () => {
  it("adds custom header with key", async () => {
    const adapter = createApiKeyAuth({ type: "api_key", header: "X-API-Key", key: "secret-k" });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.["X-API-Key"]).toBe("secret-k");
  });

  it("defaults header to X-API-Key", async () => {
    const adapter = createApiKeyAuth({ type: "api_key", key: "k" });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.["X-API-Key"]).toBe("k");
  });

  it("throws AuthError if key missing", () => {
    expect(() => createApiKeyAuth({ type: "api_key" } as any)).toThrow(AuthError);
  });
});
