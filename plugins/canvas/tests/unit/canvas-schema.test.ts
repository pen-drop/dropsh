import type { SdcComponent } from "@dropsh/sdc-client";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { extendCanvasSchema } from "../../src/canvas-schema.js";

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
    expect(componentItem.oneOf).toHaveLength(2);
    expect(componentItem.oneOf[0].additionalProperties).toBe(false);
    expect(componentItem.oneOf[0].required).toEqual(["uuid", "component_id", "inputs"]);
    expect(componentItem.oneOf[0].properties.component_id.const).toBe("sdc.my_theme.hero_card");
    expect(componentItem.oneOf[1].properties.component_id.const).toBe("sdc.olivero.teaser");
    expect(componentItem.oneOf.map((item: any) => item.properties.component_id.const)).toEqual([
      "sdc.my_theme.hero_card",
      "sdc.olivero.teaser",
    ]);
    expect(componentItem.oneOf[1].properties.component_version).toBeUndefined();
    expect(componentItem.oneOf[1].properties.inputs_resolved).toBeUndefined();
    expect(componentItem.oneOf[1].properties.slot.enum).toEqual([null, "content", "media"]);
    expect(componentItem.oneOf[1].properties.slot.description).toContain("content");
    expect(componentItem.oneOf[1].properties.slot.description).toContain("media");
    expect(componentItem.oneOf[1].properties.inputs.properties.title.type).toBe("string");
    expect(componentItem.oneOf[1].properties.inputs.required).toEqual(["title"]);
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
    expect(
      (baseSchema.properties.data.properties.attributes.properties as any).components,
    ).toBeUndefined();
  });

  it("deep-clones component-derived schemas and metadata before embedding them", () => {
    const schema = extendCanvasSchema(baseSchema, "create", [teaser]) as any;

    schema["x-dropsh-components"][0].props.properties.title.type = "number";
    schema["x-dropsh-components"][0].slots.content.title = "Changed";
    schema["x-dropsh-components"][0].variants.default.title = "Changed";
    schema.properties.data.properties.attributes.properties.components.items.oneOf[0].properties.inputs.properties.title.type =
      "number";

    expect(teaser.props.properties).toEqual({
      title: { type: "string", title: "Title" },
      summary: { type: "string", description: "Short summary." },
    });
    expect(teaser.slots.content).toEqual({ title: "Content" });
    expect(teaser.variants.default).toEqual({ title: "Default" });
  });

  it("compiles with Ajv and validates a discriminated component payload", () => {
    const schema = extendCanvasSchema(baseSchema, "create", [teaser, hero]) as Record<
      string,
      unknown
    >;
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false });
    const validate = ajv.compile(schema);

    expect(
      validate({
        data: {
          type: "canvas_page--canvas_page",
          attributes: {
            components: [
              {
                uuid: "11111111-1111-4111-8111-111111111111",
                component_id: "sdc.olivero.teaser",
                parent_uuid: null,
                slot: null,
                inputs: { title: "Hello" },
                label: "Intro teaser",
              },
            ],
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects misspelled slots", () => {
    const schema = extendCanvasSchema(baseSchema, "create", [teaser, hero]) as Record<
      string,
      unknown
    >;
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false });
    const validate = ajv.compile(schema);

    expect(
      validate({
        data: {
          type: "canvas_page--canvas_page",
          attributes: {
            components: [
              {
                uuid: "11111111-1111-4111-8111-111111111111",
                component_id: "sdc.olivero.teaser",
                parent_uuid: null,
                slot: "contents",
                inputs: { title: "Hello" },
              },
            ],
          },
        },
      }),
    ).toBe(false);
  });
});
