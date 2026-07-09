import { describe, expect, it, vi } from "vitest";
import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { runRead } from "../../../src/commands/read.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { id: "u1", type: "node--article" } })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
    collection: vi.fn(), resource: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), me: vi.fn(),
  };
}

describe("runRead", () => {
  it("reads entity by type/uuid and emits response", async () => {
    const emitted: unknown[] = [];
    const c = client();
    await runRead({ target: "node/article/u1" }, { client: c, emit: (v) => { emitted.push(v); } });
    expect(c.get).toHaveBeenCalledWith("node/article/u1");
    expect(emitted).toEqual([{ data: { id: "u1", type: "node--article" } }]);
  });

  it("validates target shape", async () => {
    await expect(runRead({ target: "bad" }, { client: client(), emit: () => {} }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("passes include as JSON:API params when given", async () => {
    const emitted: unknown[] = [];
    const c = client();
    await runRead(
      { target: "node/article/u1", include: ["field_related", "field_image"] },
      { client: c, emit: (v) => { emitted.push(v); } },
    );
    expect(c.get).toHaveBeenCalledTimes(1);
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node/article/u1");
    expect(params).toBeInstanceOf(DrupalJsonApiParams);
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "include=field_related,field_image",
    );
    expect(emitted).toEqual([{ data: { id: "u1", type: "node--article" } }]);
  });
});
