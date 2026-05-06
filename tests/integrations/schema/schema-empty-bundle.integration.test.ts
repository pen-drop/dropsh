import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema empty bundle", () => {
  it("returns a schemata-sourced schema for a bundle with no instances", async () => {
    const result = await runCli({ args: ["schema", "taxonomy_term/tags", "--refresh"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const schema = parseJson<{ [k: string]: unknown }>(result.stdout);
    expect(schema["x-dropsh-source"]).toBe("schemata");
  });
});
