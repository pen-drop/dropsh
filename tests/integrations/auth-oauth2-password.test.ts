import { describe, expect, it } from "vitest";
import { testConfig } from "./helpers/config.js";
import {
  type Auth,
  createTestNode,
  oauth2Password,
  parseError,
  parseJson,
  runCli,
} from "./helpers/run.js";

describe("integration: auth oauth2 password grant", () => {
  it("reads a node using a password-grant token", async () => {
    const uuid = await createTestNode(`it-auth-oauth2pw-${crypto.randomUUID()}`);

    const result = await runCli({
      auth: oauth2Password(),
      args: ["read", `node/article_test/${uuid}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<{ data: { id: string } }>(result.stdout);
    expect(body.data.id).toBe(uuid);
  });

  it("returns exit 3 with a wrong password", async () => {
    const cfg = testConfig();
    const badAuth: Auth = {
      type: "oauth2_password",
      clientId: cfg.oauth2.password_client_id,
      clientSecret: cfg.oauth2.password_client_secret,
      user: cfg.oauth2.user,
      pass: "wrong-password",
    };

    const result = await runCli({
      auth: badAuth,
      args: ["search", "node", "--bundle=article_test", "--limit=1"],
    });
    expect(result.code).toBe(3);
    expect(parseError(result.stderr).error.code).toBe("E_AUTH");
  });
});
