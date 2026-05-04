import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema (catalog)", () => {
  it("lists available targets with article_test and tags", async () => {
    const result = await runCli({ args: ["schema"] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const list = parseJson<Array<{ entity_type: string; bundle: string; label: string }>>(
      result.stdout,
    );
    expect(list.some((r) => r.entity_type === "node" && r.bundle === "article_test")).toBe(true);
    expect(list.some((r) => r.entity_type === "taxonomy_term" && r.bundle === "tags")).toBe(true);
  });
});
