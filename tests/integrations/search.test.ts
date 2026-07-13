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

  it("pages with --sort and --offset (AC-1, AC-2)", async () => {
    // Three nodes sharing a prefix; suffix letters give a deterministic title order.
    const prefix = `it-search-page-${crypto.randomUUID()}`;
    for (const suffix of ["a", "b", "c"]) {
      await createTestNode(`${prefix}-${suffix}`);
    }
    const common = [
      "search",
      "node",
      "--bundle=article_test",
      `--filter=title:CONTAINS:${prefix}`,
      "--sort=title",
    ];

    const page1 = await runCli({ args: [...common, "--limit=2"] });
    expect(page1.code).toBe(0);
    const titles1 = parseJson<SearchResponse>(page1.stdout).data.map((n) => n.attributes.title);
    expect(titles1).toEqual([`${prefix}-a`, `${prefix}-b`]);

    const page2 = await runCli({ args: [...common, "--limit=2", "--offset=2"] });
    expect(page2.code).toBe(0);
    const titles2 = parseJson<SearchResponse>(page2.stdout).data.map((n) => n.attributes.title);
    expect(titles2).toEqual([`${prefix}-c`]);

    // Descending sort flips the leading result.
    const desc = await runCli({ args: [...common.slice(0, 4), "--sort=-title", "--limit=1"] });
    expect(desc.code).toBe(0);
    const titlesDesc = parseJson<SearchResponse>(desc.stdout).data.map((n) => n.attributes.title);
    expect(titlesDesc).toEqual([`${prefix}-c`]);
  });

  it("keeps a colon in the filter value instead of reading it as an operator (AC-3)", async () => {
    const title = `it-search-colon-https://example.com/${crypto.randomUUID()}`;
    const uuid = await createTestNode(title);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<SearchResponse>(result.stdout);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(uuid);
  });

  it("accepts a value-less operator over the wire (AC-4)", async () => {
    await createTestNode(`it-search-notnull-${crypto.randomUUID()}`);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", "--filter=title:IS NOT NULL", "--limit=1"],
    });
    expect(result.code).toBe(0);

    const body = parseJson<SearchResponse>(result.stdout);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("maps the != alias to <> over the wire (Blocker B #2)", async () => {
    // Drupal's allowed operators include <> but not !=; a verbatim != 400s. Exit
    // 0 proves the alias was normalised to <> before the request.
    await createTestNode(`it-search-neq-${crypto.randomUUID()}`);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", "--filter=status:!=:0", "--limit=1"],
    });
    expect(result.code).toBe(0);
  });

  it("filters with an IN comma-list over the wire (Blocker B #1)", async () => {
    const a = `it-search-in-${crypto.randomUUID()}`;
    const b = `it-search-in-${crypto.randomUUID()}`;
    const uuidA = await createTestNode(a);
    const uuidB = await createTestNode(b);

    const result = await runCli({
      args: ["search", "node", "--bundle=article_test", `--filter=title:IN:${a},${b}`],
    });
    expect(result.code).toBe(0);

    const ids = parseJson<SearchResponse>(result.stdout).data.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([uuidA, uuidB]));
    expect(ids).toHaveLength(2);
  });
});
