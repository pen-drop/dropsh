import { describe, expect, it } from "vitest";
import { createTestNode, runCli } from "./helpers/run.js";

describe("integration: delete", () => {
  it("deletes a node and a follow-up read returns 404", async () => {
    const uuid = await createTestNode(`it-delete-${crypto.randomUUID()}`);

    const deletion = await runCli({ args: ["delete", `node/article_test/${uuid}`] });
    expect(deletion.code).toBe(0);

    const read = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(read.code).toBe(5);
  });

  it("--dry-run leaves the node intact", async () => {
    const uuid = await createTestNode(`it-delete-dryrun-${crypto.randomUUID()}`);

    const deletion = await runCli({ args: ["delete", `node/article_test/${uuid}`, "--dry-run"] });
    expect(deletion.code).toBe(0);

    const read = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(read.code).toBe(0);
  });
});
