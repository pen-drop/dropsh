import { describe, expect, it } from "vitest";
import { extendCanvasSchema } from "../../src/canvas-schema.js";
import type { SdcComponent } from "../../src/sdc-client.js";

const baseSchema = {
  $schema: "https://json-schema.org/draft-07/schema",
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "canvas_page--canvas_page" },
        attributes: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: [],
        },
      },
      required: ["type"],
    },
  },
  required: ["data"],
};

const teaser: SdcComponent = {
  id: "olivero:teaser",
  jsonapiId: "olivero--teaser",
  name: "Teaser",
  description: "A teaser component.",
  status: "stable",
  provider: "olivero",
  props: {
    type: "object",
    properties: {
      title: { type: "string", title: "Title" },
      summary: { type: "string", description: "Short summary." },
    },
    required: ["title"],
  },
  slots: {
    content: { title: "Content" },
  },
  variants: {
    default: { title: "Default" },
  },
};

const hero: SdcComponent = {
  id: "my_theme:hero_card",
  jsonapiId: "my_theme--hero_card",
  name: "Hero card",
  description: "A hero component.",
  status: "experimental",
  provider: "my_theme",
  props: {
    type: "object",
    properties: {
      eyebrow: { type: "string" },
    },
  },
  slots: {
    media: { title: "Media" },
  },
  variants: {},
};

describe("extendCanvasSchema", () => {
  it("adds Canvas component payload structure and metadata", () => {
    const schema = extendCanvasSchema(baseSchema, "create", [teaser, hero]) as any;

    const attrs = schema.properties.data.properties.attributes;
    const components = attrs.properties.components;
    const componentItem = components.items;

    expect(schema["x-dropsh-builder"]).toBe("canvas");
    expect(schema["x-dropsh-components"]).toEqual([
      {
        id: "sdc.olivero.teaser",
        source_id: "olivero:teaser",
        name: "Teaser",
        description: "A teaser component.",
        provider: "olivero",
        status: "stable",
        props: teaser.props,
        slots: teaser.slots,
        variants: teaser.variants,
      },
      {
        id: "sdc.my_theme.hero_card",
        source_id: "my_theme:hero_card",
        name: "Hero card",
        description: "A hero component.",
        provider: "my_theme",
        status: "experimental",
        props: hero.props,
        slots: hero.slots,
        variants: hero.variants,
      },
    ]);
    expect(components.type).toBe("array");
    expect(componentItem.additionalProperties).toBe(false);
    expect(componentItem.required).toEqual(["uuid", "component_id", "inputs"]);
    expect(componentItem.properties.component_id.enum).toEqual([
      "sdc.my_theme.hero_card",
      "sdc.olivero.teaser",
    ]);
    expect(componentItem.properties.component_version).toBeUndefined();
    expect(componentItem.properties.inputs_resolved).toBeUndefined();
    expect(componentItem.properties.slot.description).toContain("content");
    expect(componentItem.properties.slot.description).toContain("media");
    expect(componentItem.properties.inputs.oneOf[0].properties.title.type).toBe("string");
    expect(componentItem.properties.inputs.oneOf[0].required).toEqual(["title"]);
  });

  it("preserves create schema requirements and marks id as required only for update schemas", () => {
    const createSchema = extendCanvasSchema(baseSchema, "create", [teaser]) as any;
    const updateSchema = extendCanvasSchema(baseSchema, "update", [teaser]) as any;

    expect(createSchema.properties.data.required).toEqual(["type"]);
    expect(updateSchema.properties.data.required).toEqual(["type", "id"]);
  });

  it("creates the attributes path when it is absent", () => {
    const sparseSchema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: {},
          required: ["type"],
        },
      },
    };

    const schema = extendCanvasSchema(sparseSchema, "create", [teaser]) as any;

    expect(schema.properties.data.properties.attributes.properties.components.type).toBe("array");
  });

  it("deep-clones the base schema before extending it", () => {
    const schema = extendCanvasSchema(baseSchema, "create", [teaser]) as any;

    schema.properties.data.properties.attributes.properties.title.type = "number";

    expect(baseSchema.properties.data.properties.attributes.properties.title.type).toBe("string");
    expect((baseSchema.properties.data.properties.attributes.properties as any).components).toBeUndefined();
  });
});
