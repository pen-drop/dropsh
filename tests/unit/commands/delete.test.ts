import { describe, expect, it, vi } from "vitest";
import { runDelete } from "../../../src/commands/delete.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), upload: vi.fn(),
    delete: vi.fn(async () => ({ ok: true as const })),
    collection: vi.fn(),
    resource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    me: vi.fn(),
  };
}

describe("runDelete", () => {
  it("DELETEs entity_type/bundle/uuid", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runDelete({ target: `node/article/${UUID}` }, { client: c, emit: (v) => emitted.push(v) });
    expect(c.delete).toHaveBeenCalledWith(`node/article/${UUID}`);
    expect(emitted).toEqual([{ ok: true }]);
  });

  it("validates target", async () => {
    await expect(runDelete({ target: "bad" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run does not delete", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runDelete({ target: `node/article/${UUID}`, dryRun: true }, { client: c, emit: (v) => emitted.push(v) });
    expect(c.delete).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "DELETE", path: `node/article/${UUID}` });
  });
});
