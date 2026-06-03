import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestNode, runCli } from "../helpers/run.js";

describe("integration: schema --refresh", () => {
  it("re-fetches when --refresh passed and serves cache otherwise", async () => {
    await createTestNode(`ref-${crypto.randomUUID()}`, "schemata");
    // first call — populates cache
    const first = await runCli({ site: "schemata", args: ["schema", "node/article_test"] });
    expect(first.code).toBe(0);
    const cacheDir = ".dropsh/cache/schema";
    expect(existsSync(`${cacheDir}/node--article_test.create.json`)).toBe(true);
    // second call — served from cache
    const second = await runCli({ site: "schemata", args: ["schema", "node/article_test"] });
    expect(second.code).toBe(0);
    // third call — --refresh re-fetches
    const third = await runCli({
      site: "schemata",
      args: ["schema", "node/article_test", "--refresh"],
    });
    expect(third.code).toBe(0);
    expect(third.stderr).toBe("");
    // cleanup to avoid test bleed
    rmSync(".dropsh", { recursive: true, force: true });
  });
});
