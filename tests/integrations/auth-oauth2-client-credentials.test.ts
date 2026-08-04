import { AuthError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { oauth2Config } from "./helpers/config.js";
import {
  type Auth,
  createTestNode,
  oauth2ClientCred,
  parseJson,
  runCli,
  seedSession,
  testConfig,
} from "./helpers/run.js";

describe("integration: auth oauth2 client_credentials grant", () => {
  it("reads a node using a client-credentials session", async () => {
    const uuid = await createTestNode(`it-auth-oauth2cc-${crypto.randomUUID()}`);

    const result = await runCli({
      auth: oauth2ClientCred(),
      args: ["read", `node/article_test/${uuid}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<{ data: { id: string } }>(result.stdout);
    expect(body.data.id).toBe(uuid);
  });

  it("login fails with a wrong client_secret", async () => {
    // The secret is now config (not a prompt), so requireClientSecret() passes
    // the non-empty "wrong-secret" through and the token endpoint is actually
    // contacted during login (seedSession). simple_oauth rejects a bad client
    // secret with RFC 6749 `invalid_client`, which the provider surfaces as the
    // `invalid_client` reason — proving the endpoint was reached, not a
    // pre-flight `secret_not_configured` guard.
    const oauth = oauth2Config();
    const badAuth: Auth = {
      type: "oauth2_client_credentials",
      clientId: oauth.cc_client_id,
      clientSecret: "wrong-secret",
      scope: oauth.scope,
    };

    const err = await seedSession(testConfig().url, badAuth).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).details.reason).not.toBe("secret_not_configured");
    expect((err as AuthError).details.reason).toBe("invalid_client");
  });
});
