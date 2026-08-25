import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "../../../src/commands/update.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    patch: vi.fn(async () => ({
      data: { type: "node--article", id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    })),
    collection: vi.fn(),
    resource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    me: vi.fn(),
  };
}

const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TARGET = `node/article/${UUID}`;
const DOC = { data: { type: "node--article", id: UUID, attributes: { title: "X" } } };

describe("runUpdate", () => {
  it("PATCHes the given document to entity_type/bundle/uuid", async () => {
    const c = client();
    await runUpdate({ target: TARGET, payload: DOC }, { client: c, emit: () => {} });
    expect(c.patch).toHaveBeenCalledWith(TARGET, DOC);
  });

  it("validates the target shape before anything else", async () => {
    await expect(
      runUpdate({ target: "bad", payload: DOC }, { client: client(), emit: () => {} }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("dry-run emits the document without sending", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runUpdate(
      { target: TARGET, payload: { data: {} }, dryRun: true },
      {
        client: c,
        emit: (v) => {
          emitted.push(v);
        },
      },
    );
    expect(c.patch).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({ dry_run: true, method: "PATCH", path: TARGET });
  });

  it("validates the document against the schema before patching", async () => {
    const validate = vi.fn();
    const c = client();
    await runUpdate({ target: TARGET, payload: DOC }, { client: c, emit: () => {}, validate });
    expect(validate).toHaveBeenCalledWith(DOC, "node/article");
    expect(c.patch).toHaveBeenCalled();
  });

  it("throws ValidationError without patching when the validator fails", async () => {
    const validate = vi.fn(() => {
      throw new ValidationError("bad");
    });
    const c = client();
    await expect(
      runUpdate({ target: TARGET, payload: {} }, { client: c, emit: () => {}, validate }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(c.patch).not.toHaveBeenCalled();
  });

  it("skips validation when noValidate=true", async () => {
    const validate = vi.fn(() => {
      throw new ValidationError("would fail");
    });
    const c = client();
    await runUpdate(
      { target: TARGET, payload: {}, noValidate: true },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).not.toHaveBeenCalled();
    expect(c.patch).toHaveBeenCalled();
  });

  it("sends the document verbatim, whatever produced it", async () => {
    const c = client();
    const built = {
      data: {
        type: "node--article",
        id: UUID,
        relationships: { uid: { data: { type: "user--user", id: "u1" } } },
      },
    };
    await runUpdate({ target: TARGET, payload: built }, { client: c, emit: () => {} });
    expect(c.patch).toHaveBeenCalledWith(TARGET, built);
  });
});
