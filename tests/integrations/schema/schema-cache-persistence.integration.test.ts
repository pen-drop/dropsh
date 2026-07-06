import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestNode, runCli, testConfig } from "../helpers/run.js";

describe("integration: schema cache", () => {
  it("writes a cache file that is parseable JSON", async () => {
    await createTestNode(`cache-${crypto.randomUUID()}`, "schemata");
    await runCli({ site: "schemata", args: ["schema", "node/article_test", "--refresh"] });
    // The schema cache is namespaced per site host (see siteCacheRoot).
    const host = new URL(testConfig("schemata").url).host;
    const path = `.dropsh/cache/${host}/schema/node--article_test.create.json`;
    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, "utf8"));
    expect(content["x-dropsh-operation"]).toBe("create");
    // No cache cleanup here: the cache is host-scoped and entries are written
    // by several tests running concurrently — deleting it mid-run races them.
  });
});
