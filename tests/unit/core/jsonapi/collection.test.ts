import type { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { describe, expect, it } from "vitest";
import {
  type CollectionClient,
  createCollection,
} from "../../../../src/core/jsonapi/collection.js";

interface Captured {
  path: string;
  qs: string;
}

/** Stub client that records the requested path + query string and returns a fixed body. */
function stubClient(body: unknown): { client: CollectionClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const client: CollectionClient = {
    async get(path: string, params?: DrupalJsonApiParams) {
      calls.push({ path, qs: params ? params.getQueryString() : "" });
      return body;
    },
  };
  return { client, calls };
}

describe("Collection query building", () => {
  it("expands a single-segment type into entity/bundle path", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "gaia_run").list();
    expect(calls[0]!.path).toBe("gaia_run/gaia_run");
  });

  it("expands an entity/bundle spec", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article").list();
    expect(calls[0]!.path).toBe("node/article");
  });

  it("where('=') produces a shortcut filter without operator", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article").where("title", "=", "X").list();
    expect(calls[0]!.qs).toBe("filter%5Btitle%5D=X");
  });

  it("where with another operator includes the operator", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article").where("count", ">", 5).list();
    expect(decodeURIComponent(calls[0]!.qs)).toContain("filter[count][value]=5");
    expect(decodeURIComponent(calls[0]!.qs)).toContain("filter[count][operator]=>");
  });

  it("whereIn produces an IN filter with array values", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article").whereIn("status", [1, 2]).list();
    const qs = decodeURIComponent(calls[0]!.qs);
    expect(qs).toContain("filter[status][condition][path]=status");
    expect(qs).toContain("filter[status][condition][value][0]=1");
    expect(qs).toContain("filter[status][condition][value][1]=2");
    expect(qs).toContain("filter[status][condition][operator]=IN");
  });

  it("notExists produces an IS NULL filter", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article").notExists("field_done").list();
    const qs = decodeURIComponent(calls[0]!.qs);
    expect(qs).toContain("filter[field_done][condition][path]=field_done");
    expect(qs).toContain("filter[field_done][condition][operator]=IS NULL");
  });

  it("fields uses the resolved resource type for the sparse fieldset", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "gaia_run").fields(["title", "status"]).list();
    expect(decodeURIComponent(calls[0]!.qs)).toContain("fields[gaia_run--gaia_run]=title,status");
  });

  it("sort and page produce expected query parameters", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article").sort("created", "DESC").page(10).list();
    const qs = decodeURIComponent(calls[0]!.qs);
    expect(qs).toContain("sort=-created");
    expect(qs).toContain("page[limit]=10");
  });

  it("chains multiple builder methods into a single request", async () => {
    const { client, calls } = stubClient({ data: [] });
    await createCollection(client, "node/article")
      .where("title", "=", "X")
      .sort("created")
      .page(5)
      .list();
    const qs = decodeURIComponent(calls[0]!.qs);
    expect(qs).toContain("filter[title]=X");
    expect(qs).toContain("sort=created");
    expect(qs).toContain("page[limit]=5");
  });
});

describe("Collection result mapping", () => {
  const body = {
    data: [
      { id: "a", type: "node--article", attributes: { title: "First" } },
      { id: "b", type: "node--article", attributes: { title: "Second" } },
    ],
  };

  it("list maps data[] into Resource[]", async () => {
    const { client } = stubClient(body);
    const results = await createCollection(client, "node/article").list();
    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(results[0]!.attr("title")).toBe("First");
  });

  it("list returns [] when the document has no data", async () => {
    const { client } = stubClient({});
    const results = await createCollection(client, "node/article").list();
    expect(results).toEqual([]);
  });

  it("first applies page(1) and returns the first resource", async () => {
    const { client, calls } = stubClient(body);
    const r = await createCollection(client, "node/article").first();
    expect(r?.id).toBe("a");
    expect(decodeURIComponent(calls[0]!.qs)).toContain("page[limit]=1");
  });

  it("first returns null when no resources match", async () => {
    const { client } = stubClient({ data: [] });
    const r = await createCollection(client, "node/article").first();
    expect(r).toBeNull();
  });

  it("count returns the number of returned resources with an empty fieldset", async () => {
    const { client, calls } = stubClient(body);
    const n = await createCollection(client, "node/article").count();
    expect(n).toBe(2);
    expect(decodeURIComponent(calls[0]!.qs)).toContain("fields[node--article]=");
  });
});
