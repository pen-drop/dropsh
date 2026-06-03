import { ConfigError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { oauth2Plugin } from "../../src/index.js";

const BASE_TOKEN_URL = "https://example.com/oauth/token";

describe("oauth2Plugin factory validation", () => {
  it("throws ConfigError when client_id is missing", () => {
    expect(() =>
      oauth2Plugin({ type: "oauth2_authcode", client_id: "", token_url: BASE_TOKEN_URL }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError when token_url is missing", () => {
    expect(() =>
      oauth2Plugin({ type: "oauth2_authcode", client_id: "cid", token_url: "" }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError when client_secret missing for oauth2_client_credentials", () => {
    expect(() =>
      oauth2Plugin({
        type: "oauth2_client_credentials",
        client_id: "cid",
        client_secret: "",
        token_url: BASE_TOKEN_URL,
      }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError when username missing for oauth2_password", () => {
    expect(() =>
      oauth2Plugin({
        type: "oauth2_password",
        client_id: "cid",
        client_secret: "sec",
        username: "",
        password: "pw",
        token_url: BASE_TOKEN_URL,
      }),
    ).toThrow(ConfigError);
  });

  it("returns plugin with id 'oauth2' and requiredModules for valid authcode config", () => {
    const p = oauth2Plugin({ type: "oauth2_authcode", client_id: "cid", token_url: BASE_TOKEN_URL });
    expect(p.id).toBe("oauth2");
    expect(p.requiredModules).toContain("simple_oauth");
  });

  it("extendSchema returns schema unchanged", async () => {
    const p = oauth2Plugin({ type: "oauth2_authcode", client_id: "cid", token_url: BASE_TOKEN_URL });
    const schema = { type: "object" };
    expect(await p.extendSchema("node", "article", schema, {} as any)).toBe(schema);
  });
});
