import { describe, expect, it } from "vitest";
import type {
  AuthContext,
  AuthProvider,
  AuthSession,
  AuthStatusInfo,
} from "../../../../src/core/auth/types.js";

describe("auth types", () => {
  it("a minimal provider satisfies AuthProvider", () => {
    const session: AuthSession = { access_token: "x", expires_at: 1 };
    const provider: AuthProvider = {
      id: "fake",
      displayName: "Fake",
      capabilities: { login: true, logout: true, status: true },
      async login(_ctx: AuthContext) {
        return session;
      },
      async logout() {},
      async status(s): Promise<AuthStatusInfo> {
        return { loggedIn: s !== null };
      },
      createAdapter() {
        return {
          async apply(req) {
            return req;
          },
        };
      },
    };
    expect(provider.id).toBe("fake");
    expect(provider.capabilities.login).toBe(true);
  });
});
