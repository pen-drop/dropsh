import { describe, expect, it } from "vitest";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";

function baseSchema() {
  return {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          type: { const: "node--article" },
          id: { type: "string", format: "uuid" },
          attributes: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "object" } },
            required: ["title"],
          },
          relationships: {
            type: "object",
            properties: { field_tags: { type: "object" } },
            required: ["field_tags"],
          },
        },
        required: ["type", "attributes"],
      },
    },
    required: ["data"],
  };
}

describe("toOperationVariant", () => {
  it("leaves schema intact for create", () => {
    const input = baseSchema();
    const out = toOperationVariant(input, "create");
    expect(out).toEqual(input);
  });

  it("for update: clears required under data.attributes and data.relationships", () => {
    const out = toOperationVariant(baseSchema(), "update") as any;
    expect(out.properties.data.properties.attributes.required).toEqual([]);
    expect(out.properties.data.properties.relationships.required).toEqual([]);
  });

  it("for update: replaces data.required with ['type','id']", () => {
    const out = toOperationVariant(baseSchema(), "update") as any;
    expect(out.properties.data.required).toEqual(["type", "id"]);
  });

  it("does not mutate input", () => {
    const input = baseSchema();
    const before = JSON.stringify(input);
    toOperationVariant(input, "update");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("is tolerant of schemas without attributes/relationships blocks", () => {
    const thin = {
      type: "object",
      properties: {
        data: { type: "object", properties: { type: { const: "x--y" } }, required: ["type"] },
      },
    };
    const out = toOperationVariant(thin, "update") as any;
    expect(out.properties.data.required).toEqual(["type", "id"]);
  });
});
