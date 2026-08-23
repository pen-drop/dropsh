import { describe, expect, it, vi } from "vitest";
import { runCreate } from "../../../src/commands/create.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    post: vi.fn(async () => ({ data: { type: "node--article", id: "new-uuid" } })),
    collection: vi.fn(),
    resource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    me: vi.fn(),
  };
}

const DOC = { data: { type: "node--article", attributes: { title: "Hi" } } };

describe("runCreate", () => {
  it("POSTs the given document to entity_type/bundle", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      { entityType: "node", bundle: "article", payload: DOC },
      {
        client: c,
        emit: (v) => {
          emitted.push(v);
        },
      },
    );
    expect(c.post).toHaveBeenCalledWith("node/article", DOC);
    expect(emitted).toEqual([{ data: { type: "node--article", id: "new-uuid" } }]);
  });

  it("dry-run emits the document without calling the client", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      {
        entityType: "node",
        bundle: "article",
        payload: { data: { type: "node--article" } },
        dryRun: true,
      },
      {
        client: c,
        emit: (v) => {
          emitted.push(v);
        },
      },
    );
    expect(c.post).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      {
        dry_run: true,
        method: "POST",
        path: "node/article",
        payload: { data: { type: "node--article" } },
      },
    ]);
  });

  it("validates the document against the schema before posting", async () => {
    const validate = vi.fn();
    const c = client();
    await runCreate(
      { entityType: "node", bundle: "article", payload: DOC },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).toHaveBeenCalledWith(DOC, "node/article");
    expect(c.post).toHaveBeenCalled();
  });

  it("throws ValidationError without posting when the validator fails", async () => {
    const validate = vi.fn(() => {
      throw new ValidationError("bad", { errors: [{ message: "nope" }] });
    });
    const c = client();
    await expect(
      runCreate(
        { entityType: "node", bundle: "article", payload: {} },
        { client: c, emit: () => {}, validate },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("skips validation when noValidate=true", async () => {
    const validate = vi.fn(() => {
      throw new ValidationError("would fail");
    });
    const c = client();
    await runCreate(
      { entityType: "node", bundle: "article", payload: {}, noValidate: true },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).not.toHaveBeenCalled();
    expect(c.post).toHaveBeenCalled();
  });

  it("sends the document verbatim, whatever produced it", async () => {
    const c = client();
    const built = {
      data: {
        type: "node--article",
        attributes: { title: "Built" },
        relationships: { uid: { data: { type: "user--user", id: "u1" } } },
      },
    };
    await runCreate(
      { entityType: "node", bundle: "article", payload: built },
      { client: c, emit: () => {} },
    );
    expect(c.post).toHaveBeenCalledWith("node/article", built);
  });
});
