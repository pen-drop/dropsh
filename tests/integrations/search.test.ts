import { describe, expect, it } from "vitest";
import { createTestNode, parseJson, runCli } from "./helpers/run.js";

type SearchResponse = {
  data: Array<{ id: string; attributes: { title: string; status: boolean } }>;
};

describe("integration: search", () => {
  it("returns up to --limit results", async () => {
    await createTestNode(`it-search-setup-${crypto.randomUUID()}`);
    await createTestNode(`it-search-setup-${crypto.randomUUID()}`);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", "--limit=5"],
    });
    expect(result.code).toBe(0);

    const body = parseJson<SearchResponse>(result.stdout);
    expect(body.data.length).toBeLessThanOrEqual(5);
  });

  it("filters by exact title", async () => {
    const title = `it-search-exact-${crypto.randomUUID()}`;
    const uuid = await createTestNode(title);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<SearchResponse>(result.stdout);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(uuid);
  });

  it("filters by status operator", async () => {
    await createTestNode(`it-search-status-${crypto.randomUUID()}`);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", "--filter=status:=:1", "--limit=2"],
    });
    expect(result.code).toBe(0);

    const body = parseJson<SearchResponse>(result.stdout);
    for (const item of body.data) {
      expect(item.attributes.status).toBe(true);
    }
  });
});
