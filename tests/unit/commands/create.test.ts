import { describe, expect, it, vi } from "vitest";
import { runCreate } from "../../../src/commands/create.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    post: vi.fn(async () => ({ data: { id: "new-uuid" } })),
  };
}

describe("runCreate", () => {
  it("POSTs to entity_type/bundle with given data", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      { entityType: "node", bundle: "article", dataArg: '{"data":{"type":"node--article","attributes":{"title":"Hi"}}}' },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Hi" } },
    });
    expect(emitted).toEqual([{ data: { id: "new-uuid" } }]);
  });

  it("dry-run returns payload without calling client", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      { entityType: "node", bundle: "article", dataArg: '{"data":{"type":"node--article"}}', dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.post).not.toHaveBeenCalled();
    expect(emitted).toEqual([{
      dry_run: true,
      method: "POST",
      path: "node/article",
      payload: { data: { type: "node--article" } },
    }]);
  });
});
