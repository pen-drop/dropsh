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

  // DROPSH-13: `token_url` is composed outside dropsh as `${baseUrl}/oauth/token`,
  // so a trailing slash on base_url yields `//oauth/token`. That URL never reaches
  // the token endpoint, and the server's reply names no cause. Reject the shape here,
  // before any request is issued, since token_url never passes through loadConfig.
  describe("token_url shape (DROPSH-13)", () => {
    it("rejects an empty path segment and names the corrected value", () => {
      expect(() =>
        oauth2Plugin({
          type: "oauth2_client_credentials",
          client_id: "c",
          token_url: "https://example.com//oauth/token",
        }),
      ).toThrow(/token_url.*https:\/\/example\.com\/oauth\/token/s);
    });

    it("accepts a canonical https token_url", () => {
      expect(() =>
        oauth2Plugin({
          type: "oauth2_client_credentials",
          client_id: "c",
          token_url: "https://example.com/oauth/token",
        }),
      ).not.toThrow();
    });

    // The `//` in the scheme must never be mistaken for the defect — a naive
    // `token_url.includes("//")` would reject every well-formed URL.
    it("accepts a canonical http token_url", () => {
      expect(() =>
        oauth2Plugin({
          type: "oauth2_client_credentials",
          client_id: "c",
          token_url: "http://example.com/oauth/token",
        }),
      ).not.toThrow();
    });
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

  describe("oauth2_device_code config", () => {
    const valid = {
      type: "oauth2_device_code",
      client_id: "my-client",
      device_authorization_url: "https://example.org/oauth/device_authorization",
      token_url: "https://example.org/oauth/token",
    } as const;

    it("accepts a complete device profile", () => {
      expect(() => oauth2Plugin(valid)).not.toThrow();
    });

    it("rejects a device profile without device_authorization_url", () => {
      const { device_authorization_url: _omitted, ...without } = valid;
      expect(() => oauth2Plugin(without as never)).toThrow(/device_authorization_url/);
    });

    it("rejects a device_authorization_url with an empty path segment", () => {
      expect(() =>
        oauth2Plugin({ ...valid, device_authorization_url: "https://example.org//oauth/device" }),
      ).toThrow(/device_authorization_url/);
    });
  });
});
