import { describe, expect, it } from "vitest";
import { testConfig } from "./helpers/config.js";
import { type Auth, parseError, runCli } from "./helpers/run.js";

describe("integration: auth basic", () => {
  it("reads a node using a seeded basic-auth session", async () => {
    const result = await runCli({
      auth: { type: "basic", user: testConfig().basic.user, pass: testConfig().basic.pass },
      args: ["search", "node", "--bundle=article_test", "--limit=1"],
    });
    expect(result.code).toBe(0);
  });

  it("returns exit 5 with wrong password", async () => {
    // basicAuthProvider.login does not contact the server: it just base64-encodes
    // the credentials. So the bad password is seeded into the session and the
    // failure surfaces at request time as an HTTP 401/403 (exit 5).
    const cfg = testConfig();
    const badAuth: Auth = { type: "basic", user: cfg.basic.user, pass: "wrong-password" };
    const payload = JSON.stringify({
      data: {
        type: "node--article_test",
        attributes: { title: `it-auth-basic-${crypto.randomUUID()}` },
      },
    });

    const result = await runCli({
      auth: badAuth,
      args: ["create", "node", "--bundle=article_test", `--data=${payload}`],
    });
    expect(result.code).toBe(5);
    expect(parseError(result.stderr).error.code).toBe("E_HTTP");
  });
});
