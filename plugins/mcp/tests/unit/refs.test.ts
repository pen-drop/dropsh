import { ValidationError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { rebaseLocalRefs } from "../../src/refs.js";

describe("rebaseLocalRefs", () => {
  it("rewrites document-local pointers onto the embedding pointer", () => {
    const source = {
      properties: {
        attributes: { $ref: "#/definitions/attributes" },
      },
      definitions: {
        attributes: { type: "object", required: ["title"] },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(source));
    const out = rebaseLocalRefs(source, "#/oneOf/0/properties/payload") as {
      properties: { attributes: { $ref: string } };
      definitions: { attributes: { $ref?: string } };
    };
    expect(out.properties.attributes.$ref).toBe(
      "#/oneOf/0/properties/payload/definitions/attributes",
    );
    expect(source).toEqual(snapshot);
  });

  it("rebases recursive local refs", () => {
    const out = rebaseLocalRefs(
      { definitions: { node: { properties: { child: { $ref: "#/definitions/node" } } } } },
      "#/oneOf/1/properties/payload",
    ) as { definitions: { node: { properties: { child: { $ref: string } } } } };
    expect(out.definitions.node.properties.child.$ref).toBe(
      "#/oneOf/1/properties/payload/definitions/node",
    );
  });

  it("rejects unsupported external refs instead of dropping them", () => {
    expect(() =>
      rebaseLocalRefs(
        { $ref: "https://jsonapi.org/schema#/definitions/resource" },
        "#/oneOf/0/properties/payload",
      ),
    ).toThrow(ValidationError);
    expect(() => rebaseLocalRefs({ $ref: "definitions/type" }, "#/oneOf/0")).toThrow(/unsupported/);
  });
});
