import { describe, expect, it } from "vitest";
import { createJwtAuth } from "../../../../src/core/auth/jwt.js";
import { AuthError } from "../../../../src/errors.js";

describe("jwt auth", () => {
  it("adds Bearer header with token", async () => {
    const adapter = createJwtAuth({ type: "jwt", token: "abc.def.ghi" });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe("Bearer abc.def.ghi");
  });

  it("throws AuthError if token missing", () => {
    expect(() => createJwtAuth({ type: "jwt" } as any)).toThrow(AuthError);
  });
});
