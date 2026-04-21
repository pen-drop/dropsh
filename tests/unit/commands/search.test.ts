import { describe, expect, it, vi } from "vitest";
import { runSearch, parseFilterFlag } from "../../../src/commands/search.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn(),
  };
}

describe("parseFilterFlag", () => {
  it("parses key:value", () => {
    expect(parseFilterFlag("title:Hello")).toEqual({ key: "title", value: "Hello" });
  });
  it("parses key:op:value", () => {
    expect(parseFilterFlag("title:CONTAINS:World"))
      .toEqual({ key: "title", operator: "CONTAINS", value: "World" });
  });
  it("throws on malformed", () => {
    expect(() => parseFilterFlag("nocolons")).toThrow(ValidationError);
  });
});

describe("runSearch", () => {
  it("GETs entity_type/bundle with filters and limit", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runSearch(
      { entityType: "node", bundle: "article", filters: ["title:Hello"], limit: 10 },
      { client: c, emit: (v) => emitted.push(v) },
    );
    expect(c.get).toHaveBeenCalledWith("node/article", {
      filter: [{ key: "title", value: "Hello" }],
      page: { limit: 10 },
    });
    expect(emitted).toHaveLength(1);
  });

  it("works without bundle", async () => {
    const c = client();
    await runSearch({ entityType: "node", filters: [], limit: 50 }, { client: c, emit: () => {} });
    expect(c.get).toHaveBeenCalledWith("node", { filter: [], page: { limit: 50 } });
  });
});
