import { describe, expect, it, vi } from "vitest";
import { runUploadFile } from "../../../src/commands/upload-file.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    upload: vi.fn(async () => ({ data: { id: "file-uuid" } })),
    collection: vi.fn(), resource: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), me: vi.fn(),
  };
}

describe("runUploadFile", () => {
  it("uploads file contents to target field", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "up-"));
    const p = path.join(dir, "hero.jpg");
    await writeFile(p, Buffer.from("img"));
    const c = client();
    const emitted: unknown[] = [];
    await runUploadFile(
      { target: "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image", file: p },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.upload).toHaveBeenCalledWith(
      "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image",
      "hero.jpg",
      expect.any(Buffer),
    );
    expect(emitted).toEqual([{ data: { id: "file-uuid" } }]);
  });

  it("validates target shape", async () => {
    await expect(runUploadFile({ target: "bad", file: "/x" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("validates missing files", async () => {
    await expect(
      runUploadFile(
        { target: "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image", file: "/does/not/exist.png" },
        { client: client(), emit: () => {} },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run emits plan without uploading", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "up-"));
    const p = path.join(dir, "a.txt");
    await writeFile(p, "hi");
    const c = client();
    const emitted: unknown[] = [];
    await runUploadFile(
      { target: "node/article/abcdef01-abcd-abcd-abcd-abcdef012345/field_image", file: p, dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.upload).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "POST-upload", bytes: 2 });
  });
});
