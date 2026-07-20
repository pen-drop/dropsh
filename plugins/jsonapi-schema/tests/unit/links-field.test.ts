import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { buildWriteSchema } from "../../src/jsonapi-schema.js";

// biome-ignore lint/suspicious/noExplicitAny: deep JSON structure under test
function get(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => acc?.[k], obj);
}

/**
 * A resource-object schema whose `attributes` carries a base field literally
 * named `links` (the gaia_ticket case), plus real JSON hyper-schema `links`
 * keywords at schema-node positions that must still be stripped.
 */
const resourceSchema = {
  $schema: "http://json-schema.org/draft-06/schema#",
  $id: "https://example.com/gaia_ticket.schema.json",
  title: "gaia_ticket--gaia_ticket",
  allOf: [
    {
      properties: {
        type: { const: "gaia_ticket--gaia_ticket" },
        attributes: { $ref: "#/definitions/attributes" },
        relationships: { $ref: "#/definitions/relationships" },
      },
    },
    { $ref: "https://jsonapi.org/schema#/definitions/resource" },
  ],
  definitions: {
    attributes: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: 255 },
        links: {
          type: "array",
          title: "Links",
          items: {
            type: "object",
            properties: {
              uri: { type: "string", format: "uri" },
              title: { type: "string" },
            },
          },
        },
      },
      // hyper-schema keyword at the attributes schema node — must be stripped.
      links: [{ rel: "self", href: "https://example.com/self" }],
    },
    relationships: {
      type: "object",
      properties: {
        field_tags: {
          type: "object",
          // hyper-schema keyword inside a relationship field node — must be stripped.
          links: [{ rel: "related", href: "https://example.com/related" }],
          properties: { data: { type: "array" } },
        },
      },
    },
  },
};

describe("buildWriteSchema — links field survives sanitize (GAIA-184 / GAIA-187)", () => {
  it("keeps the entity field literally named `links` inside attributes.properties", () => {
    const out = buildWriteSchema(resourceSchema);
    const links = get(out, "properties.data.properties.attributes.properties.links");
    expect(links).toBeTruthy();
    expect(links.type).toBe("array");
    expect(get(links, "items.properties.uri")).toBeTruthy();
    expect(get(links, "items.properties.title")).toBeTruthy();
  });

  it("keeps attributes.additionalProperties strict (false)", () => {
    const out = buildWriteSchema(resourceSchema);
    expect(get(out, "properties.data.properties.attributes.additionalProperties")).toBe(false);
  });

  it("still strips a hyper-schema `links` keyword at a schema-node position", () => {
    const out = buildWriteSchema(resourceSchema);
    // attributes-node-level `links` keyword is gone…
    const attrs = get(out, "properties.data.properties.attributes");
    expect(attrs.links).toBeUndefined();
    // …and the relationship field node's `links` keyword is gone…
    const fieldTags = get(out, "properties.data.properties.relationships.properties.field_tags");
    expect(fieldTags.links).toBeUndefined();
    // …while the field literally named `links` is preserved (see previous test).
  });

  it("still strips document-identity keywords ($schema/$id) from resolved nodes", () => {
    const out = buildWriteSchema(resourceSchema);
    const json = JSON.stringify(get(out, "properties.data.properties.attributes"));
    expect(json).not.toContain("$id");
    expect(json).not.toContain("jsonapi.org");
  });

  it("compiles and accepts an update payload carrying attributes.links", () => {
    const out = buildWriteSchema(resourceSchema);
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(out as object);
    const ok = validate({
      data: {
        type: "gaia_ticket--gaia_ticket",
        attributes: {
          title: "x",
          links: [{ uri: "https://gitlab.example/mr/1", title: "MR !1" }],
        },
      },
    });
    expect(ok).toBe(true);
  });

  it("still rejects an unknown attribute (additionalProperties intact)", () => {
    const out = buildWriteSchema(resourceSchema);
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(out as object);
    const ok = validate({
      data: {
        type: "gaia_ticket--gaia_ticket",
        attributes: { bogus: 1 },
      },
    });
    expect(ok).toBe(false);
  });
});
