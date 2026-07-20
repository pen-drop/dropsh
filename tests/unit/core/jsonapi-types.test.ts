import { describe, expect, it } from "vitest";
import type { JsonApiDocument, JsonApiResource } from "../../../src/core/jsonapi/types.js";

describe("JsonApiDocument", () => {
  it("accepts a single-resource document", () => {
    const res: JsonApiResource = { type: "node--article", id: "u1", attributes: { title: "Hi" } };
    const doc: JsonApiDocument = { data: res };
    expect(Array.isArray(doc.data)).toBe(false);
    expect((doc.data as JsonApiResource).id).toBe("u1");
  });

  it("accepts a collection document with included", () => {
    const doc: JsonApiDocument = {
      data: [{ type: "node--article", id: "u1" }],
      included: [{ type: "user--user", id: "a1" }],
    };
    expect(Array.isArray(doc.data)).toBe(true);
    expect(doc.included?.[0]?.id).toBe("a1");
  });
});
