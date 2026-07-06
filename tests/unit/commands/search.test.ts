import { describe, expect, it, vi } from "vitest";
import { DrupalJsonApiParams } from "drupal-jsonapi-params";
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
      { client: c, emit: (v) => { emitted.push(v); } },
    );
    expect(c.get).toHaveBeenCalledTimes(1);
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node/article");
    expect(params).toBeInstanceOf(DrupalJsonApiParams);
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false }))
      .toBe("filter[title]=Hello&page[limit]=10");
    expect(emitted).toHaveLength(1);
  });

  it("works without bundle and passes operator filters", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: ["status:!=:1"], limit: 50 },
      { client: c, emit: () => {} },
    );
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node");
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false }))
      .toBe("filter[status][value]=1&filter[status][operator]=!=&page[limit]=50");
  });

  it("adds include alongside filters and page limit", async () => {
    const c = client();
    await runSearch(
      {
        entityType: "node",
        bundle: "article",
        filters: ["title:Hello"],
        limit: 10,
        include: ["field_related", "field_image"],
      },
      { client: c, emit: () => {} },
    );
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node/article");
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "filter[title]=Hello&include=field_related,field_image&page[limit]=10",
    );
  });
});
