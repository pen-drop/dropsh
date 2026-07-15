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

  it("accepts client_secret in oauth2_client_credentials config", () => {
    const plugin = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/oauth/token",
      client_secret: "shh",
    });
    expect(plugin.id).toBe("oauth2");
    expect(plugin.authProvider?.id).toBe("oauth2_client_credentials");
  });

  it("validates required fields", () => {
    expect(() =>
      oauth2Plugin({ type: "oauth2_authcode", client_id: "", token_url: "https://x/oauth/token" }),
    ).toThrow();
  });

  it("keeps the constant plugin id when no profile id is configured", () => {
    const plugin = oauth2Plugin({
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/oauth/token",
    });
    expect(plugin.id).toBe("oauth2");
  });

  it("derives a distinct plugin id per configured profile id", () => {
    const session = oauth2Plugin({
      id: "session",
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/oauth/token",
    });
    const pm = oauth2Plugin({
      id: "pm",
      type: "oauth2_client_credentials",
      client_id: "c",
      token_url: "https://x/oauth/token",
    });
    // Distinct plugin ids so the two profiles are not collapsed by the
    // emit-dedup during plugin resolution (DROPSH-12).
    expect(session.id).toBe("oauth2:session");
    expect(pm.id).toBe("oauth2:pm");
    // Provider identity stays the bare profile id, so `--auth-profile <id>` is unchanged.
    expect(session.authProvider?.id).toBe("session");
    expect(pm.authProvider?.id).toBe("pm");
  });
});
