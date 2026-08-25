import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

interface Doc {
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, { data?: { type: string; id: string } }>;
  };
}

async function createNode(title: string): Promise<Doc> {
  const created = await runCli({
    site: "schemata",
    args: [
      "create",
      "node",
      "--bundle=article_test",
      "--title",
      title,
      "--body.value",
      "original body",
    ],
  });
  expect(created.code, created.stderr).toBe(0);
  return parseJson<Doc>(created.stdout);
}

/** The fixture user the integration suite authenticates as. */
async function testerUuid(): Promise<string> {
  const found = await runCli({
    site: "schemata",
    args: ["search", "user", "--bundle=user", "--filter=name:tester"],
  });
  expect(found.code, found.stderr).toBe(0);
  const uuid = parseJson<{ data: Array<{ id: string }> }>(found.stdout).data[0]?.id;
  expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
  return uuid as string;
}

describe("integration: update from field parameters", () => {
  it("AC 8: PATCHes only the supplied field and leaves the rest intact", async () => {
    const doc = await createNode(`params-update-${crypto.randomUUID()}`);
    const updated = await runCli({
      site: "schemata",
      args: ["update", `node/article_test/${doc.data.id}`, "--title", "changed title"],
    });
    expect(updated.code, updated.stderr).toBe(0);

    const read = await runCli({
      site: "schemata",
      args: ["read", `node/article_test/${doc.data.id}`],
    });
    expect(read.code, read.stderr).toBe(0);
    const back = parseJson<Doc>(read.stdout);
    expect(back.data.attributes.title).toBe("changed title");
    expect((back.data.attributes.body as { value: string }).value).toBe("original body");
  });

  it("AC 4: sets a relationship from a bare UUID", async () => {
    const doc = await createNode(`params-rel-${crypto.randomUUID()}`);
    const uid = await testerUuid();

    const updated = await runCli({
      site: "schemata",
      args: ["update", `node/article_test/${doc.data.id}`, "--uid", uid],
    });
    expect(updated.code, updated.stderr).toBe(0);

    const read = await runCli({
      site: "schemata",
      args: ["read", `node/article_test/${doc.data.id}`],
    });
    expect(read.code, read.stderr).toBe(0);
    const back = parseJson<Doc>(read.stdout);
    expect(back.data.relationships?.uid?.data?.id).toBe(uid);
    expect(back.data.relationships?.uid?.data?.type).toBe("user--user");
  });
});
