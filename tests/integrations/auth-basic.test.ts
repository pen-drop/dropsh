import { describe, expect, it } from "vitest";
import { testConfig } from "./helpers/config.js";
import { parseError, runCli, type Auth } from "./helpers/run.js";

describe("integration: auth basic", () => {
  it("returns exit 5 with wrong password", async () => {
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
