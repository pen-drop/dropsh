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
    // The token exchange happens during login (seedSession), so a bad secret is
    // rejected by the token endpoint there with an AuthError.
    const oauth = oauth2Config();
    const badAuth: Auth = {
      type: "oauth2_client_credentials",
      clientId: oauth.cc_client_id,
      clientSecret: "wrong-secret",
      scope: oauth.scope,
    };

    await expect(seedSession(testConfig().url, badAuth)).rejects.toThrow();
  });
});
