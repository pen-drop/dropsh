import { describe, expect, it } from "vitest";
import { testConfig } from "./helpers/config.js";
import { createTestNode, oauth2ClientCred, parseError, parseJson, runCli, type Auth } from "./helpers/run.js";

describe("integration: auth oauth2 client_credentials grant", () => {
  it("reads a node using a client-credentials token", async () => {
    const uuid = await createTestNode(`it-auth-oauth2cc-${crypto.randomUUID()}`);

    const result = await runCli({
      auth: oauth2ClientCred(),
      args: ["read", `node/article_test/${uuid}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<{ data: { id: string } }>(result.stdout);
    expect(body.data.id).toBe(uuid);
  });

  it("returns exit 3 with a wrong client_secret", async () => {
    const cfg = testConfig();
    const badAuth: Auth = {
      type: "oauth2_client_credentials",
      clientId: cfg.oauth2.cc_client_id,
      clientSecret: "wrong-secret",
    };

    const result = await runCli({
      auth: badAuth,
      args: ["search", "node", "--bundle=article_test", "--limit=1"],
    });
    expect(result.code).toBe(3);
    expect(parseError(result.stderr).error.code).toBe("E_AUTH");
  });
});
