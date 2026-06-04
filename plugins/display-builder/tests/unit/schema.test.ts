import type { SdcComponent } from "@dropsh/sdc-client";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import type { DisplayBuilderMetadata } from "../../src/metadata-client.js";
import { extendDisplayBuilderSchema } from "../../src/schema.js";

type JsonSchemaObject = Record<string, unknown>;
type ActiveMetadataFixture = DisplayBuilderMetadata & {
  enabled: true;
  profile: { id: string; label: string };
  overrideProfile: { id: string; label: string };
  instanceId: string;
};

const baseSchema = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "node--article" },
        attributes: {
          type: "object",
          properties: {
            title: { type: "string" },
            field_display_builder_override: { type: "object" },
            field_other: { type: "string" },
          },
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

const activeMetadata = {
  enabled: true,
  entityType: "node",
  bundle: "article",
  viewMode: "default",
  profile: { id: "default", label: "Default" },
  overrideField: "field_display_builder_override",
  overrideProfile: { id: "content", label: "Content" },
  instanceId: "node.article.default",
  sourceTree: [{ source_id: "component" }],
  sources: [
    {
      id: "component",
      label: "Component",
      sourceType: "component",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_id: { type: "string", const: "component" },
          source: {
            type: "object",
            additionalProperties: false,
            properties: {
              component: {
                type: "object",
                additionalProperties: false,
                properties: {
                  component_id: { type: "string" },
                  props: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                    },
                    required: ["title"],
                  },
                  slots: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      content: { type: "string" },
                    },
                  },
                },
                required: ["component_id", "props"],
              },
            },
            required: ["component"],
          },
        },
        required: ["source_id", "source"],
      },
    },
    {
      id: "unsupported_remote",
      label: "Remote",
      sourceType: "remote",
      schema: { type: "object", additionalProperties: true },
    },
  ],
  allowedComponents: [
    {
      id: "olivero:teaser",
      sourceId: "olivero:teaser",
      name: "Teaser",
      schema: { type: "object" },
    },
    {
      id: "missing:component",
      sourceId: "missing:component",
      name: "Missing",
      schema: { type: "object" },
    },
  ],
  unsupportedSources: [
    {
      id: "unsupported_remote",
      label: "Remote",
      sourceType: "remote",
      reason: "Remote sources are not writable.",
    },
  ],
} as ActiveMetadataFixture;

function asSchemaObject(value: unknown): JsonSchemaObject {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonSchemaObject;
}

function schemaProperty(parent: JsonSchemaObject, key: string): JsonSchemaObject {
  return asSchemaObject(asSchemaObject(parent.properties)[key]);
}

function overrideField(schema: unknown): JsonSchemaObject {
  const root = asSchemaObject(schema);
  const data = schemaProperty(root, "data");
  const attributes = schemaProperty(data, "attributes");
  return schemaProperty(attributes, "field_display_builder_override");
}

function sourceVariants(schema: unknown): JsonSchemaObject[] {
  const items = asSchemaObject(overrideField(schema).items);
  expect(Array.isArray(items.oneOf)).toBe(true);
  return items.oneOf as JsonSchemaObject[];
}

function compileSchema(schema: unknown) {
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
  return ajv.compile(schema as Record<string, unknown>);
}

describe("extendDisplayBuilderSchema", () => {
  it("returns the same schema object for inactive metadata", () => {
    const metadata: DisplayBuilderMetadata = { enabled: false };

    const schema = extendDisplayBuilderSchema(baseSchema, metadata, [teaser]);

    expect(schema).toBe(baseSchema);
  });

  it("returns the same schema object for active metadata without an override field", () => {
    const metadata = { ...activeMetadata, overrideField: "" };

    const schema = extendDisplayBuilderSchema(baseSchema, metadata, [teaser]);

    expect(schema).toBe(baseSchema);
  });

  it("extends only data.attributes.<overrideField>", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]);

    const attrs = asSchemaObject(
      schemaProperty(schemaProperty(asSchemaObject(schema), "data"), "attributes").properties,
    );
    expect(attrs.title).toEqual(baseSchema.properties.data.properties.attributes.properties.title);
    expect(attrs.field_other).toEqual(
      baseSchema.properties.data.properties.attributes.properties.field_other,
    );
    expect(asSchemaObject(attrs.field_display_builder_override).type).toBe("array");
    expect(sourceVariants(schema)).toHaveLength(1);
    expect(asSchemaObject(schema)["x-dropsh-builder"]).toBe("display-builder");
    expect(asSchemaObject(schema)["x-dropsh-display-builder"]).toEqual({
      entity_type: "node",
      bundle: "article",
      view_mode: "default",
      profile: "default",
      override_field: "field_display_builder_override",
      override_profile: "content",
      instance_id: "node.article.default",
      source_tree: [{ source_id: "component" }],
      unsupported_sources: activeMetadata.unsupportedSources,
    });
  });

  it("restricts component_id to allowed Display Builder components present in SDC", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser, hero]);
    const [variant] = sourceVariants(schema);
    const source = schemaProperty(schemaProperty(asSchemaObject(variant), "source"), "component");

    const componentId = schemaProperty(source, "component_id");
    expect(componentId.enum).toEqual(["olivero:teaser"]);
    expect(componentId.enum).not.toContain("sdc.olivero.teaser");
    expect(componentId.enum).not.toContain("my_theme:hero_card");
  });

  it("preserves the Display Builder component source schema constraints", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]);
    const [variant] = sourceVariants(schema);
    const component = schemaProperty(
      schemaProperty(asSchemaObject(variant), "source"),
      "component",
    );
    const props = schemaProperty(component, "props");
    const slots = schemaProperty(component, "slots");

    expect(component.additionalProperties).toBe(false);
    expect(component.required).toEqual(["component_id", "props"]);
    expect(props).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    });
    expect(slots).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string" },
      },
    });
  });

  it("adds only supported source plugins to oneOf and lists unsupported sources in metadata", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]);
    const oneOf = sourceVariants(schema);

    expect(oneOf.map((variant) => schemaProperty(variant, "source_id").const)).toEqual([
      "component",
    ]);
    expect(asSchemaObject(schema)["x-dropsh-sources"]).toEqual(activeMetadata.sources);
    expect(
      asSchemaObject(asSchemaObject(schema)["x-dropsh-display-builder"]).unsupported_sources,
    ).toEqual(activeMetadata.unsupportedSources);
  });

  it("emits a valid empty array field schema when no allowed components match SDC", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [hero]);
    const field = overrideField(schema);
    const validate = compileSchema(schema);

    expect(field).toMatchObject({ type: "array", maxItems: 0 });
    expect(field.items).toBeUndefined();
    expect(
      validate({
        data: {
          type: "node--article",
          attributes: { field_display_builder_override: [] },
        },
      }),
    ).toBe(true);
  });

  it("emits a valid empty array field schema when no supported sources remain", () => {
    const metadata = {
      ...activeMetadata,
      sources: activeMetadata.sources.filter((source) => source.id !== "component"),
    };
    const schema = extendDisplayBuilderSchema(baseSchema, metadata, [teaser]);
    const field = overrideField(schema);
    const validate = compileSchema(schema);

    expect(field).toMatchObject({ type: "array", maxItems: 0 });
    expect(field.items).toBeUndefined();
    expect(
      validate({
        data: {
          type: "node--article",
          attributes: {
            field_display_builder_override: [
              {
                source_id: "component",
                source: { component: { component_id: "olivero:teaser" } },
              },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      asSchemaObject(asSchemaObject(schema)["x-dropsh-display-builder"]).unsupported_sources,
    ).toEqual(activeMetadata.unsupportedSources);
  });

  it("deep-clones the base schema, component metadata, and source metadata", () => {
    const schema = asSchemaObject(extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]));

    schemaProperty(schemaProperty(schema, "data"), "attributes").properties = {
      ...asSchemaObject(schemaProperty(schemaProperty(schema, "data"), "attributes").properties),
      title: { type: "number" },
    };
    const [componentMetadata] = schema["x-dropsh-components"] as JsonSchemaObject[];
    const props = asSchemaObject(componentMetadata?.props);
    schemaProperty(props, "title").type = "number";
    asSchemaObject(componentMetadata?.slots).content = { title: "Changed" };
    asSchemaObject(componentMetadata?.variants).default = { title: "Changed" };
    const [sourceMetadata] = schema["x-dropsh-sources"] as JsonSchemaObject[];
    schemaProperty(
      schemaProperty(schemaProperty(asSchemaObject(sourceMetadata?.schema), "source"), "component"),
      "component_id",
    ).type = "number";

    expect(baseSchema.properties.data.properties.attributes.properties.title.type).toBe("string");
    expect(
      baseSchema.properties.data.properties.attributes.properties.field_display_builder_override
        .type,
    ).toBe("object");
    expect(teaser.props.properties).toEqual({
      title: { type: "string", title: "Title" },
    });
    expect(teaser.slots.content).toEqual({ title: "Content" });
    expect(teaser.variants.default).toEqual({ title: "Default" });
    expect(schemaProperty(asSchemaObject(activeMetadata.sources[0]?.schema), "source_id")).toEqual({
      type: "string",
      const: "component",
    });
  });

  it("compiles with Ajv and validates a simple component source payload", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]) as Record<
      string,
      unknown
    >;
    const validate = compileSchema(schema);

    expect(
      validate({
        data: {
          type: "node--article",
          attributes: {
            field_display_builder_override: [
              {
                source_id: "component",
                source: {
                  component: {
                    component_id: "olivero:teaser",
                    props: { title: "Hello" },
                    slots: { content: "Body" },
                  },
                },
              },
            ],
          },
        },
      }),
    ).toBe(true);
    expect(
      validate({
        data: {
          type: "node--article",
          attributes: {
            field_display_builder_override: [
              {
                source_id: "component",
                source: {
                  component: {
                    component_id: "olivero:teaser",
                    props: { title: 123 },
                    slots: { content: "Body" },
                  },
                },
              },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      validate({
        data: {
          type: "node--article",
          attributes: {
            field_display_builder_override: [
              {
                source_id: "unsupported_remote",
                source: { value: "anything" },
              },
            ],
          },
        },
      }),
    ).toBe(false);
  });
});
