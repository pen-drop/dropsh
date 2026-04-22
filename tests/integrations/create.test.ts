import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "./helpers/run.js";

type SearchResponse = { data: Array<{ id: string }> };

function payload(title: string): string {
  return JSON.stringify({
    data: {
      type: "node--article_test",
      attributes: { title, field_test_text: "integration-create" },
    },
  });
}

async function searchByTitle(title: string): Promise<string[]> {
  const result = await runCli({
    args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
  });
  const body = parseJson<SearchResponse>(result.stdout);
  return body.data.map((item) => item.id);
}

describe("integration: create", () => {
  it("creates a node and returns its UUID", async () => {
    const title = `it-create-${crypto.randomUUID()}`;
    const result = await runCli({
      args: ["create", "node", "--bundle=article_test", `--data=${payload(title)}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<{ data: { id: string } }>(result.stdout);
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await searchByTitle(title)).toHaveLength(1);
  });

  it("--dry-run does not write", async () => {
    const title = `it-create-dryrun-${crypto.randomUUID()}`;
    const result = await runCli({
      args: ["create", "node", "--bundle=article_test", `--data=${payload(title)}`, "--dry-run"],
    });
    expect(result.code).toBe(0);
    expect(await searchByTitle(title)).toHaveLength(0);
  });

  it("--data=@file works the same as inline", async () => {
    const title = `it-create-file-${crypto.randomUUID()}`;
    const dir = mkdtempSync(join(tmpdir(), "drupal-cli-data-"));
    const path = join(dir, "data.json");
    writeFileSync(path, payload(title), "utf8");

    const result = await runCli({
      args: ["create", "node", "--bundle=article_test", `--data=@${path}`],
    });
    expect(result.code).toBe(0);
    expect(await searchByTitle(title)).toHaveLength(1);
  });
});
