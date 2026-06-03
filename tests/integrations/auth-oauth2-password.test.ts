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
    // The token exchange happens during login (seedSession), so a bad password
    // is rejected by the token endpoint there with an AuthError.
    const oauth = oauth2Config();
    const badAuth: Auth = {
      type: "oauth2_password",
      clientId: oauth.password_client_id,
      clientSecret: oauth.password_client_secret,
      user: oauth.user,
      pass: "wrong-password",
      scope: oauth.scope,
    };

    await expect(seedSession(testConfig().url, badAuth)).rejects.toThrow();
  });
});
