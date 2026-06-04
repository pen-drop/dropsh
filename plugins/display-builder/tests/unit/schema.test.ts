import type { SdcComponent } from "@dropsh/sdc-client";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import type { DisplayBuilderMetadata } from "../../src/metadata-client.js";
import { extendDisplayBuilderSchema } from "../../src/schema.js";

type JsonSchemaObject = Record<string, unknown>;

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

const activeMetadata: DisplayBuilderMetadata = {
  enabled: true,
  entityType: "node",
  bundle: "article",
  viewMode: "default",
  profile: { id: "default", label: "Default" },
  profileConfig: {
    drupal_internal__id: "default",
    label: "Default",
    islands: {
      component_library: {
        status: true,
        filters: { provider: ["olivero"] },
      },
    },
  },
  overrideField: "field_display_builder_override",
  overrideProfile: { id: "content", label: "Content" },
  overrideProfileConfig: {
    drupal_internal__id: "content",
    label: "Content",
  },
  sourceTree: [{ source_id: "component" }],
  componentLibrary: {
    status: true,
    filters: { provider: ["olivero"] },
  },
};

function asSchemaObject(value: unknown): JsonSchemaObject {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonSchemaObject;
}

function schemaProperty(parent: JsonSchemaObject, key: string): JsonSchemaObject {
  return asSchemaObject(asSchemaObject(parent.properties)[key]);
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

  it("extends only data.attributes.<overrideField> with a permissive source-tree schema", () => {
    const schema = extendDisplayBuilderSchema(baseSchema, activeMetadata, [teaser, hero]);

    const attrs = asSchemaObject(
      schemaProperty(schemaProperty(asSchemaObject(schema), "data"), "attributes").properties,
    );
    expect(attrs.title).toEqual(baseSchema.properties.data.properties.attributes.properties.title);
    expect(attrs.field_other).toEqual(
      baseSchema.properties.data.properties.attributes.properties.field_other,
    );
    expect(asSchemaObject(attrs.field_display_builder_override)).toEqual({
      type: "array",
      description: "Display Builder source tree for the configured entity-view override field.",
      items: {
        type: "object",
        additionalProperties: true,
      },
    });
  });

  it("emits Display Builder config and all SDC components as schema metadata", () => {
    const schema = asSchemaObject(
      extendDisplayBuilderSchema(baseSchema, activeMetadata, [hero, teaser]),
    );

    expect(schema["x-dropsh-builder"]).toBe("display-builder");
    expect(schema["x-dropsh-display-builder"]).toEqual({
      entity_type: "node",
      bundle: "article",
      view_mode: "default",
      profile: "default",
      profile_config: activeMetadata.profileConfig,
      override_field: "field_display_builder_override",
      override_profile: "content",
      override_profile_config: activeMetadata.overrideProfileConfig,
      source_tree: [{ source_id: "component" }],
      component_library: {
        status: true,
        filters: { provider: ["olivero"] },
      },
    });
    expect(schema["x-dropsh-components"]).toEqual([
      {
        id: "my_theme:hero_card",
        name: "Hero card",
        description: "A hero component.",
        provider: "my_theme",
        status: "experimental",
        props: hero.props,
        slots: hero.slots,
        variants: hero.variants,
      },
      {
        id: "olivero:teaser",
        name: "Teaser",
        description: "A teaser component.",
        provider: "olivero",
        status: "stable",
        props: teaser.props,
        slots: teaser.slots,
        variants: teaser.variants,
      },
    ]);
    expect(schema["x-dropsh-sources"]).toBeUndefined();
  });

  it("deep-clones the base schema, component metadata, and Display Builder metadata", () => {
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
    const dbMetadata = asSchemaObject(schema["x-dropsh-display-builder"]);
    asSchemaObject(dbMetadata.component_library).status = false;

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
    expect(asSchemaObject(activeMetadata.componentLibrary).status).toBe(true);
  });

  it("compiles with Ajv and accepts configured Display Builder source payloads", () => {
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
                    component_id: "any:component",
                    props: { title: 123 },
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
            field_display_builder_override: { source_id: "component" },
          },
        },
      }),
    ).toBe(false);
  });
});
