import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { describe, expect, it, vi } from "vitest";
import { parseFilterFlag, runSearch } from "../../../src/commands/search.js";
import type { JsonApiClient } from "../../../src/core/jsonapi/client.js";
import { ValidationError } from "../../../src/errors.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    collection: vi.fn(),
    resource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    me: vi.fn(),
  };
}

describe("parseFilterFlag", () => {
  it("parses key:value", () => {
    expect(parseFilterFlag("title:Hello")).toEqual({ key: "title", value: "Hello" });
  });
  it("parses key:op:value", () => {
    expect(parseFilterFlag("title:CONTAINS:World")).toEqual({
      key: "title",
      operator: "CONTAINS",
      value: "World",
    });
  });
  it("keeps a colon in the value when segment 2 is not a known operator (AC-3)", () => {
    expect(parseFilterFlag("link:https://example.com/x")).toEqual({
      key: "link",
      value: "https://example.com/x",
    });
  });
  it("treats segment 2 as operator only when it is a known operator", () => {
    // '!=' is a known operator alias -> operator split
    expect(parseFilterFlag("status:!=:1")).toEqual({ key: "status", operator: "!=", value: "1" });
  });
  it("parses value-less IS NULL operator (AC-4)", () => {
    expect(parseFilterFlag("conductor_id:IS NULL")).toEqual({
      key: "conductor_id",
      operator: "IS NULL",
      value: null,
    });
  });
  it("parses value-less IS NOT NULL operator (AC-4)", () => {
    expect(parseFilterFlag("conductor_id:IS NOT NULL")).toEqual({
      key: "conductor_id",
      operator: "IS NOT NULL",
      value: null,
    });
  });
  it("recognises BETWEEN as an operator (Blocker B #3)", () => {
    expect(parseFilterFlag("age:BETWEEN:1,9")).toEqual({
      key: "age",
      operator: "BETWEEN",
      value: "1,9",
    });
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
      {
        client: c,
        emit: (v) => {
          emitted.push(v);
        },
      },
    );
    expect(c.get).toHaveBeenCalledTimes(1);
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node/article");
    expect(params).toBeInstanceOf(DrupalJsonApiParams);
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "filter[title]=Hello&page[limit]=10",
    );
    expect(emitted).toHaveLength(1);
  });

  it("works without bundle and maps the != alias to <> before addFilter (Blocker B #2)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: ["status:!=:1"], limit: 50 },
      { client: c, emit: () => {} },
    );
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node");
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "filter[status][value]=1&filter[status][operator]=<>&page[limit]=50",
    );
  });

  it("splits IN values on commas into an array (Blocker B #1)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: ["tid:IN:1,2,3"], limit: 50 },
      { client: c, emit: () => {} },
    );
    const [, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "filter[tid][condition][path]=tid&filter[tid][condition][value][0]=1&filter[tid][condition][value][1]=2&filter[tid][condition][value][2]=3&filter[tid][condition][operator]=IN&page[limit]=50",
    );
  });

  it("splits BETWEEN values on commas into an array (Blocker B #3)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: ["age:BETWEEN:1,9"], limit: 50 },
      { client: c, emit: () => {} },
    );
    const [, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "filter[age][condition][path]=age&filter[age][condition][value][0]=1&filter[age][condition][value][1]=9&filter[age][condition][operator]=BETWEEN&page[limit]=50",
    );
  });

  it("throws on a non-integer --offset (Minor 4)", async () => {
    const c = client();
    await expect(
      runSearch(
        { entityType: "node", filters: [], limit: 50, offset: Number.NaN },
        { client: c, emit: () => {} },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws on a negative --offset (Minor 4)", async () => {
    const c = client();
    await expect(
      runSearch(
        { entityType: "node", filters: [], limit: 50, offset: -5 },
        { client: c, emit: () => {} },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("throws on a bare --sort dash (Minor 5)", async () => {
    const c = client();
    await expect(
      runSearch(
        { entityType: "node", filters: [], limit: 50, sort: "-" },
        { client: c, emit: () => {} },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("sets page[offset] when offset is given (AC-1)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: [], limit: 50, offset: 50 },
      { client: c, emit: () => {} },
    );
    const [, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "page[limit]=50&page[offset]=50",
    );
  });

  it("maps --sort with leading - to descending JSON:API sort (AC-2)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: [], limit: 50, sort: "-created" },
      { client: c, emit: () => {} },
    );
    const [, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "page[limit]=50&sort=-created",
    );
  });

  it("maps --sort without prefix to ascending JSON:API sort (AC-2)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: [], limit: 50, sort: "created" },
      { client: c, emit: () => {} },
    );
    const [, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "page[limit]=50&sort=created",
    );
  });

  it("passes a value-less operator filter to the request (AC-4)", async () => {
    const c = client();
    await runSearch(
      { entityType: "node", filters: ["conductor_id:IS NULL"], limit: 50 },
      { client: c, emit: () => {} },
    );
    const [, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((params as DrupalJsonApiParams).getQueryString({ encode: false })).toBe(
      "filter[conductor_id][condition][path]=conductor_id&filter[conductor_id][condition][operator]=IS NULL&page[limit]=50",
    );
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
