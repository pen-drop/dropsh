import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "../../../src/commands/update.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    patch: vi.fn(async () => ({ data: { id: "u1" } })),
  };
}

describe("runUpdate", () => {
  it("PATCHes entity_type/bundle/uuid with data", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runUpdate(
      { target: "node/article/u1", dataArg: '{"data":{"type":"node--article","id":"u1","attributes":{"title":"X"}}}' },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.patch).toHaveBeenCalledWith("node/article/u1", {
      data: { type: "node--article", id: "u1", attributes: { title: "X" } },
    });
  });

  it("validates target shape", async () => {
    await expect(runUpdate({ target: "bad", dataArg: "{}" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run emits payload without sending", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runUpdate(
      { target: "node/article/u1", dataArg: '{"data":{}}', dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.patch).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "PATCH", path: "node/article/u1" });
  });
});
