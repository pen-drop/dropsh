import { describe, expect, it } from "vitest";
import {
  type JsonApiResourceObject,
  toResource,
} from "../../../../src/core/jsonapi/resource.js";

describe("toResource", () => {
  const obj: JsonApiResourceObject = {
    id: "r1",
    type: "gaia_run--gaia_run",
    attributes: { title: "Hello", count: 3 },
    relationships: {
      conductor_id: { data: { id: "c1", type: "gaia_conductor--gaia_conductor" } },
      tags: {
        data: [
          { id: "t1", type: "taxonomy_term--tags" },
          { id: "t2", type: "taxonomy_term--tags" },
        ],
      },
      owner: { data: null },
    },
  };

  it("exposes id and type", () => {
    const r = toResource(obj);
    expect(r.id).toBe("r1");
    expect(r.type).toBe("gaia_run--gaia_run");
    expect(r.raw).toBe(obj);
  });

  it("attr reads typed attributes and returns undefined for missing keys", () => {
    const r = toResource(obj);
    expect(r.attr<string>("title")).toBe("Hello");
    expect(r.attr<number>("count")).toBe(3);
    expect(r.attr("missing")).toBeUndefined();
  });

  it("attr returns undefined when attributes is absent", () => {
    const r = toResource({ id: "x", type: "node--article" });
    expect(r.attr("title")).toBeUndefined();
  });

  it("rel returns to-one related id", () => {
    const r = toResource(obj);
    expect(r.rel("conductor_id")).toBe("c1");
  });

  it("rel returns first id for a to-many relationship", () => {
    const r = toResource(obj);
    expect(r.rel("tags")).toBe("t1");
  });

  it("rel returns null for null relationship data and missing keys", () => {
    const r = toResource(obj);
    expect(r.rel("owner")).toBeNull();
    expect(r.rel("missing")).toBeNull();
  });

  it("rels returns all ids for a to-many relationship", () => {
    const r = toResource(obj);
    expect(r.rels("tags")).toEqual(["t1", "t2"]);
  });

  it("rels wraps a to-one relationship into a single-element array", () => {
    const r = toResource(obj);
    expect(r.rels("conductor_id")).toEqual(["c1"]);
  });

  it("rels returns empty array for null relationship and missing keys", () => {
    const r = toResource(obj);
    expect(r.rels("owner")).toEqual([]);
    expect(r.rels("missing")).toEqual([]);
  });
});
