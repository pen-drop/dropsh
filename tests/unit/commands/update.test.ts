import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "../../../src/commands/update.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), post: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    patch: vi.fn(async () => ({ data: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" } })),
    collection: vi.fn(), resource: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), me: vi.fn(),
  };
}

describe("runUpdate", () => {
  it("PATCHes entity_type/bundle/uuid with data", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runUpdate(
      { target: "node/article/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", dataArg: '{"data":{"type":"node--article","id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","attributes":{"title":"X"}}}' },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.patch).toHaveBeenCalledWith("node/article/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
      data: { type: "node--article", id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", attributes: { title: "X" } },
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
      { target: "node/article/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", dataArg: '{"data":{}}', dryRun: true },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.patch).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "PATCH", path: "node/article/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
  });

  it("validates payload against schema before patching", async () => {
    const validate = vi.fn();
    const c = client();
    await runUpdate(
      { target: "node/article/00000000-0000-0000-0000-000000000001", dataArg: JSON.stringify({ data: { type: "node--article", id: "00000000-0000-0000-0000-000000000001", attributes: { title: "new" } } }) },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).toHaveBeenCalledWith(expect.anything(), "node/article");
    expect(c.patch).toHaveBeenCalled();
  });

  it("throws ValidationError without patching when validator fails", async () => {
    const validate = vi.fn(() => { throw new ValidationError("bad"); });
    const c = client();
    await expect(runUpdate(
      { target: "node/article/00000000-0000-0000-0000-000000000001", dataArg: "{}" },
      { client: c, emit: () => {}, validate },
    )).rejects.toBeInstanceOf(ValidationError);
    expect(c.patch).not.toHaveBeenCalled();
  });

  it("skips validation when noValidate=true", async () => {
    const validate = vi.fn(() => { throw new ValidationError("would fail"); });
    const c = client();
    await runUpdate(
      { target: "node/article/00000000-0000-0000-0000-000000000001", dataArg: "{}", noValidate: true },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).not.toHaveBeenCalled();
    expect(c.patch).toHaveBeenCalled();
  });
});
