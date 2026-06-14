import { describe, expect, it, vi } from "vitest";
import { runCreate } from "../../../src/commands/create.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    post: vi.fn(async () => ({ data: { id: "new-uuid" } })),
    collection: vi.fn(), resource: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), me: vi.fn(),
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

  it("validates payload against schema before posting", async () => {
    const validate = vi.fn();
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      { entityType: "node", bundle: "article", dataArg: JSON.stringify({ data: { type: "node--article", attributes: { title: "ok" } } }) },
      { client: c, emit: (v) => emitted.push(v), validate },
    );
    expect(validate).toHaveBeenCalledWith(expect.anything(), "node/article");
    expect(c.post).toHaveBeenCalled();
  });

  it("throws ValidationError without posting when validator fails", async () => {
    const validate = vi.fn(() => { throw new ValidationError("bad", { errors: [{ message: "nope" }] }); });
    const c = client();
    await expect(runCreate(
      { entityType: "node", bundle: "article", dataArg: "{}" },
      { client: c, emit: () => {}, validate },
    )).rejects.toBeInstanceOf(ValidationError);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("skips validation when noValidate=true", async () => {
    const validate = vi.fn(() => { throw new ValidationError("would fail"); });
    const c = client();
    await runCreate(
      { entityType: "node", bundle: "article", dataArg: "{}", noValidate: true },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).not.toHaveBeenCalled();
    expect(c.post).toHaveBeenCalled();
  });
});
