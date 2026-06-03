import { describe, expect, it } from "vitest";
import { oauth2Plugin } from "../../src/index.js";

describe("oauth2Plugin", () => {
  it("exposes an authProvider whose id matches the configured grant type", () => {
    const plugin = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/oauth/token",
    });
    expect(plugin.authProvider?.id).toBe("oauth2_client_credentials");
    expect(plugin.requiredModules).toContain("simple_oauth");
  });

  it("validates required fields", () => {
    expect(() =>
      oauth2Plugin({ type: "oauth2_authcode", client_id: "", token_url: "https://x/oauth/token" }),
    ).toThrow();
  });
});
