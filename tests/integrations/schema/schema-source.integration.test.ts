import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema source", () => {
  it("returns a schemata-sourced schema with no warning", async () => {
    const result = await runCli({ args: ["schema", "node/article_test", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const schema = parseJson<{ [k: string]: unknown }>(result.stdout);
    expect(schema["x-drupal-cli-source"]).toBe("schemata");
    expect(schema["x-drupal-cli-target"]).toEqual({ entity_type: "node", bundle: "article_test" });
    expect(schema["x-drupal-cli-operation"]).toBe("create");
  });
});
