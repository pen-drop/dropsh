import { describe, expect, it } from "vitest";
import { createTestNode, parseJson, runCli } from "./helpers/run.js";

type NodeBody = { data: { attributes: { title: string } } };

async function readTitle(uuid: string): Promise<string> {
  const result = await runCli({ args: ["read", `node/article_test/${uuid}`] });
  return parseJson<NodeBody>(result.stdout).data.attributes.title;
}

function patchPayload(uuid: string, title: string): string {
  return JSON.stringify({
    data: {
      type: "node--article_test",
      id: uuid,
      attributes: { title, field_test_text: "integration-update" },
    },
  });
}

describe("integration: update", () => {
  it("updates a node title", async () => {
    const original = `it-update-orig-${crypto.randomUUID()}`;
    const updated = `it-update-new-${crypto.randomUUID()}`;
    const uuid = await createTestNode(original);

    const result = await runCli({
      args: ["update", `node/article_test/${uuid}`, `--data=${patchPayload(uuid, updated)}`],
    });
    expect(result.code).toBe(0);
    expect(await readTitle(uuid)).toBe(updated);
  });

  it("--dry-run does not mutate", async () => {
    const original = `it-update-dryrun-${crypto.randomUUID()}`;
    const updated = `it-update-dryrun-new-${crypto.randomUUID()}`;
    const uuid = await createTestNode(original);

    const result = await runCli({
      args: ["update", `node/article_test/${uuid}`, `--data=${patchPayload(uuid, updated)}`, "--dry-run"],
    });
    expect(result.code).toBe(0);
    expect(await readTitle(uuid)).toBe(original);
  });
});
