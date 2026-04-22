import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestNode, parseError, parseJson, runCli } from "./helpers/run.js";

const PNG = resolve("tests/integrations/fixtures/hero.png");

describe("integration: upload-file", () => {
  it("uploads a PNG to field_image and attaches it", async () => {
    const uuid = await createTestNode(`it-upload-${crypto.randomUUID()}`);

    const upload = await runCli({
      args: ["upload-file", `--target=node/article_test/${uuid}/field_image`, `--file=${PNG}`],
    });
    expect(upload.code).toBe(0);

    const fileBody = parseJson<{ data: { id: string } }>(upload.stdout);
    expect(fileBody.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const read = await runCli({ args: ["read", `node/article_test/${uuid}`] });
    expect(read.code).toBe(0);

    const nodeBody = parseJson<{
      data: { relationships?: { field_image?: { data: { id: string } | null } } };
    }>(read.stdout);
    expect(nodeBody.data.relationships?.field_image?.data?.id).toBe(fileBody.data.id);
  });

  it("returns exit 4 when --file does not exist", async () => {
    const uuid = await createTestNode(`it-upload-missing-${crypto.randomUUID()}`);

    const result = await runCli({
      args: [
        "upload-file",
        `--target=node/article_test/${uuid}/field_image`,
        "--file=/nonexistent/does-not-exist.png",
      ],
    });
    expect(result.code).toBe(4);
    expect(parseError(result.stderr).error.code).toBe("E_VALIDATION");
  });
});
