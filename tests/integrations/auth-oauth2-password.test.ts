import { AuthError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { oauth2Config } from "./helpers/config.js";
import {
  type Auth,
  createTestNode,
  oauth2Password,
  parseJson,
  runCli,
  seedSession,
  testConfig,
} from "./helpers/run.js";

describe("integration: auth oauth2 password grant", () => {
  it("reads a node using a password-grant session", async () => {
    const uuid = await createTestNode(`it-auth-oauth2pw-${crypto.randomUUID()}`);

    const result = await runCli({
      auth: oauth2Password(),
      args: ["read", `node/article_test/${uuid}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<{ data: { id: string } }>(result.stdout);
    expect(body.data.id).toBe(uuid);
  });

  it("login fails with a wrong password", async () => {
    // With a valid (config-supplied) client secret, requireClientSecret() passes
    // and the token endpoint is actually contacted during login (seedSession).
    // simple_oauth rejects the wrong resource-owner password with RFC 6749
    // `invalid_grant`, which the provider maps to the generic
    // `credentials_rejected` reason — proving the endpoint was reached, not a
    // pre-flight `secret_not_configured` guard.
    const oauth = oauth2Config();
    const badAuth: Auth = {
      type: "oauth2_password",
      clientId: oauth.password_client_id,
      clientSecret: oauth.password_client_secret,
      user: oauth.user,
      pass: "wrong-password",
      scope: oauth.scope,
    };

    const err = await seedSession(testConfig().url, badAuth).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).details.reason).not.toBe("secret_not_configured");
    expect((err as AuthError).details.reason).toBe("credentials_rejected");
  });
});
