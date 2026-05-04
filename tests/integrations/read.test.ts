import { describe, expect, it } from "vitest";
import { createTestNode, parseError, parseJson, runCli } from "./helpers/run.js";

describe("integration: read", () => {
  it("reads an existing node", async () => {
    const title = `it-read-${crypto.randomUUID()}`;
    const uuid = await createTestNode(title);

    const result = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const body = parseJson<{ data: { id: string; attributes: { title: string } } }>(result.stdout);
    expect(body.data.id).toBe(uuid);
    expect(body.data.attributes.title).toBe(title);
  });

  it("returns exit 5 for an unknown UUID", async () => {
    const result = await runCli({
      args: ["read", "node/article_test/00000000-0000-0000-0000-000000000000"],
    });
    expect(result.code).toBe(5);
    expect(parseError(result.stderr).error.code).toBe("E_HTTP");
  });
});
