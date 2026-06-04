import type { SdcComponent } from "@dropsh/sdc-client";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import type { DisplayBuilderMetadata } from "../../src/metadata-client.js";
import { extendDisplayBuilderSchema } from "../../src/schema.js";

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
  sources: [
    {
      id: "component",
      label: "Component",
      sourceType: "component",
      schema: { type: "object", properties: { component_id: { type: "string" } } },
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
} as DisplayBuilderMetadata & {
  enabled: true;
  profile: { id: string; label: string };
  overrideProfile: { id: string; label: string };
  instanceId: string;
};

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
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]) as any;

    const attrs = schema.properties.data.properties.attributes.properties;
    expect(attrs.title).toEqual(baseSchema.properties.data.properties.attributes.properties.title);
    expect(attrs.field_other).toEqual(
      baseSchema.properties.data.properties.attributes.properties.field_other,
    );
    expect(attrs.field_display_builder_override.type).toBe("array");
    expect(attrs.field_display_builder_override.items.oneOf).toHaveLength(1);
    expect(schema["x-dropsh-builder"]).toBe("display-builder");
    expect(schema["x-dropsh-display-builder"]).toEqual({
      entity_type: "node",
      bundle: "article",
      view_mode: "default",
      profile: "default",
      override_field: "field_display_builder_override",
      override_profile: "content",
      instance_id: "node.article.default",
      unsupported_sources: activeMetadata.unsupportedSources,
    });
  });

  it("restricts component_id to allowed Display Builder components present in SDC", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser, hero]) as any;
    const component = schema.properties.data.properties.attributes.properties
      .field_display_builder_override.items.oneOf[0].properties.source.properties.component;

    expect(component.properties.component_id.enum).toEqual(["olivero:teaser"]);
    expect(component.properties.component_id.enum).not.toContain("sdc.olivero.teaser");
    expect(component.properties.component_id.enum).not.toContain("my_theme:hero_card");
  });

  it("adds only supported source plugins to oneOf and lists unsupported sources in metadata", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]) as any;
    const oneOf = schema.properties.data.properties.attributes.properties
      .field_display_builder_override.items.oneOf;

    expect(oneOf.map((variant: any) => variant.properties.source_id.const)).toEqual(["component"]);
    expect(schema["x-dropsh-sources"]).toEqual(activeMetadata.sources);
    expect(schema["x-dropsh-display-builder"].unsupported_sources).toEqual(
      activeMetadata.unsupportedSources,
    );
  });

  it("deep-clones the base schema, component metadata, and source metadata", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]) as any;

    schema.properties.data.properties.attributes.properties.title.type = "number";
    schema["x-dropsh-components"][0].props.properties.title.type = "number";
    schema["x-dropsh-components"][0].slots.content.title = "Changed";
    schema["x-dropsh-components"][0].variants.default.title = "Changed";
    schema["x-dropsh-sources"][0].schema.properties.component_id.type = "number";

    expect(baseSchema.properties.data.properties.attributes.properties.title.type).toBe("string");
    expect(baseSchema.properties.data.properties.attributes.properties.field_display_builder_override.type).toBe(
      "object",
    );
    expect(teaser.props.properties).toEqual({
      title: { type: "string", title: "Title" },
    });
    expect(teaser.slots.content).toEqual({ title: "Content" });
    expect(teaser.variants.default).toEqual({ title: "Default" });
    expect(activeMetadata.sources[0]!.schema.properties).toEqual({
      component_id: { type: "string" },
    });
  });

  it("compiles with Ajv and validates a simple component source payload", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser]) as Record<
      string,
      unknown
    >;
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false });
    const validate = ajv.compile(schema);

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
                    slots: {},
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
