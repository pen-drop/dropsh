import type { SdcComponent } from "@dropsh/sdc-client";
import type { DisplayBuilderMetadata } from "./metadata-client.js";

type JsonSchemaObject = Record<string, unknown>;
type ActiveDisplayBuilderMetadata = Extract<DisplayBuilderMetadata, { enabled: true }> & {
  profile?: string | { id?: string };
  overrideProfile?: string | { id?: string };
  instanceId?: string;
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSchema(schema: unknown): JsonSchemaObject {
  return cloneValue(schema) as JsonSchemaObject;
}

function ensureObjectProperty(parent: JsonSchemaObject, key: string): JsonSchemaObject {
  parent.properties ??= {};
  const properties = parent.properties as Record<string, JsonSchemaObject>;
  properties[key] ??= { type: "object" };

  const child = properties[key];
  child.type ??= "object";
  child.properties ??= {};
  return child;
}

function idValue(value: string | { id?: string } | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return value?.id;
}

function metadataComponentId(component: ActiveDisplayBuilderMetadata["allowedComponents"][number]) {
  return component.id.includes(":") ? component.id : component.sourceId;
}

function componentSourceSchema(componentIds: string[]): JsonSchemaObject {
  return {
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
              component_id: { type: "string", enum: componentIds },
              props: { type: "object", additionalProperties: true },
              slots: { type: "object", additionalProperties: true },
            },
            required: ["component_id"],
          },
        },
        required: ["component"],
      },
    },
    required: ["source_id", "source"],
  };
}

function sourceTreeSchema(variants: JsonSchemaObject[]): JsonSchemaObject {
  const description = "Display Builder source tree for the configured entity-view override field.";
  if (variants.length === 0) {
    return {
      type: "array",
      maxItems: 0,
      description,
    };
  }

  return {
    type: "array",
    description,
    items: {
      oneOf: variants,
    },
  };
}

function componentMetadata(component: SdcComponent): JsonSchemaObject {
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    provider: component.provider,
    status: component.status,
    props: cloneValue(component.props),
    slots: cloneValue(component.slots),
    variants: cloneValue(component.variants),
  };
}

export function extendDisplayBuilderSchema(
  baseSchema: unknown,
  metadata: DisplayBuilderMetadata,
  components: SdcComponent[],
): unknown {
  if (!metadata.enabled || !metadata.overrideField) {
    return baseSchema;
  }

  const schema = cloneSchema(baseSchema);
  const data = ensureObjectProperty(schema, "data");
  const attributes = ensureObjectProperty(data, "attributes");
  const activeMetadata = metadata as ActiveDisplayBuilderMetadata;
  const allowedIds = new Set(
    activeMetadata.allowedComponents.map((component) => metadataComponentId(component)),
  );
  const matchedComponents = components
    .filter((component) => allowedIds.has(component.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const matchedComponentIds = matchedComponents.map((component) => component.id);
  const variants = activeMetadata.sources
    .filter((source) => source.id === "component" && matchedComponentIds.length > 0)
    .map(() => componentSourceSchema(matchedComponentIds));

  const attributeProperties = attributes.properties as Record<string, JsonSchemaObject>;
  attributeProperties[activeMetadata.overrideField] = sourceTreeSchema(variants);

  schema["x-dropsh-builder"] = "display-builder";
  schema["x-dropsh-display-builder"] = {
    entity_type: activeMetadata.entityType,
    bundle: activeMetadata.bundle,
    view_mode: activeMetadata.viewMode,
    profile: idValue(activeMetadata.profile),
    override_field: activeMetadata.overrideField,
    override_profile: idValue(activeMetadata.overrideProfile),
    instance_id: activeMetadata.instanceId,
    unsupported_sources: cloneValue(activeMetadata.unsupportedSources),
  };
  schema["x-dropsh-components"] = matchedComponents.map(componentMetadata);
  schema["x-dropsh-sources"] = cloneValue(activeMetadata.sources);

  return schema;
}
