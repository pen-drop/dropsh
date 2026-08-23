import { describe, expect, it } from "vitest";
import { parseError, parseJson, runCli } from "../helpers/run.js";

interface Doc {
  data: { id: string; type: string; attributes: Record<string, unknown> };
}

async function searchByTitle(title: string): Promise<unknown[]> {
  const search = await runCli({
    site: "schemata",
    args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
  });
  expect(search.code, search.stderr).toBe(0);
  return parseJson<{ data: unknown[] }>(search.stdout).data;
}

describe("integration: create from field parameters", () => {
  it("AC 1: builds and POSTs a document from named parameters", async () => {
    const title = `params-create-${crypto.randomUUID()}`;
    const created = await runCli({
      site: "schemata",
      args: [
        "create",
        "node",
        "--bundle=article_test",
        "--title",
        title,
        "--body.value",
        "Body from a parameter",
      ],
    });
    expect(created.code, created.stderr).toBe(0);
    const doc = parseJson<Doc>(created.stdout);
    expect(doc.data.type).toBe("node--article_test");
    expect(doc.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const read = await runCli({
      site: "schemata",
      args: ["read", `node/article_test/${doc.data.id}`],
    });
    expect(read.code, read.stderr).toBe(0);
    const back = parseJson<Doc>(read.stdout);
    expect(back.data.attributes.title).toBe(title);
    expect((back.data.attributes.body as { value: string }).value).toBe("Body from a parameter");
  });

  it("AC 3: an unknown parameter exits 4 and creates nothing", async () => {
    const title = `params-unknown-${crypto.randomUUID()}`;
    const result = await runCli({
      site: "schemata",
      args: ["create", "node", "--bundle=article_test", "--titel", title],
    });
    expect(result.code).toBe(4);
    const errLine =
      result.stderr.split("\n").find((l) => l.includes("E_VALIDATION")) ?? result.stderr;
    expect(parseError(errLine).error.message).toMatch(/unknown parameter 'titel'/);

    expect(await searchByTitle(title)).toHaveLength(0);
  });

  it("AC 6: --dry-run prints the built document and creates nothing", async () => {
    const title = `params-dry-${crypto.randomUUID()}`;
    const result = await runCli({
      site: "schemata",
      args: ["create", "node", "--bundle=article_test", "--title", title, "--dry-run"],
    });
    expect(result.code, result.stderr).toBe(0);
    const out = parseJson<{ dry_run: boolean; method: string; payload: Doc }>(result.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.method).toBe("POST");
    expect(out.payload.data.attributes.title).toBe(title);

    expect(await searchByTitle(title)).toHaveLength(0);
  });
});
