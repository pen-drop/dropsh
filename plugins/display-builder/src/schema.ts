import type { SdcComponent } from "@dropsh/sdc-client";
import type { DisplayBuilderMetadata } from "./metadata-client.js";

type JsonSchemaObject = Record<string, unknown>;
type ActiveDisplayBuilderMetadata = Extract<DisplayBuilderMetadata, { enabled: true }>;

function cloneValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
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

function idValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function sourceTreeSchema(): JsonSchemaObject {
  return {
    type: "array",
    description: "Display Builder source tree for the configured entity-view override field.",
    items: {
      type: "object",
      additionalProperties: true,
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
  const attributeProperties = attributes.properties as Record<string, JsonSchemaObject>;
  const sortedComponents = [...components].sort((a, b) => a.id.localeCompare(b.id));

  attributeProperties[activeMetadata.overrideField] = sourceTreeSchema();

  schema["x-dropsh-builder"] = "display-builder";
  schema["x-dropsh-display-builder"] = {
    entity_type: activeMetadata.entityType,
    bundle: activeMetadata.bundle,
    view_mode: activeMetadata.viewMode,
    profile: idValue(activeMetadata.profile),
    profile_config: cloneValue(activeMetadata.profileConfig),
    override_field: activeMetadata.overrideField,
    override_profile: idValue(activeMetadata.overrideProfile),
    override_profile_config: cloneValue(activeMetadata.overrideProfileConfig),
    source_tree: cloneValue(activeMetadata.sourceTree),
    component_library: cloneValue(activeMetadata.componentLibrary),
  };
  schema["x-dropsh-components"] = sortedComponents.map(componentMetadata);

  return schema;
}
