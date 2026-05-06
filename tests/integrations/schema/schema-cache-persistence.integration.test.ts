import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestNode, runCli } from "../helpers/run.js";

describe("integration: schema cache", () => {
  it("writes a cache file that is parseable JSON", async () => {
    await createTestNode(`cache-${crypto.randomUUID()}`);
    await runCli({ args: ["schema", "node/article_test", "--refresh"] });
    const path = ".dropsh/cache/schema/node--article_test.create.json";
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, "utf8"));
    expect(content["x-dropsh-operation"]).toBe("create");
    rmSync(".dropsh", { recursive: true, force: true });
  });
});
