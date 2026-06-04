import type { SdcComponent } from "@dropsh/sdc-client";
import type { DisplayBuilderMetadata } from "./metadata-client.js";

type JsonSchemaObject = Record<string, unknown>;
type ActiveDisplayBuilderMetadata = Extract<DisplayBuilderMetadata, { enabled: true }> & {
  profile?: unknown;
  overrideProfile?: unknown;
  instanceId?: string;
};

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

function metadataComponentId(component: ActiveDisplayBuilderMetadata["allowedComponents"][number]) {
  return component.id.includes(":") ? component.id : component.sourceId;
}

function schemaProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
  if (typeof schema.properties !== "object" || schema.properties === null) {
    schema.properties = {};
  }
  return schema.properties as Record<string, JsonSchemaObject>;
}

function restrictComponentIdProperty(schema: JsonSchemaObject, componentIds: string[]) {
  schema.type ??= "string";
  schema.enum = componentIds;
  delete schema.const;
}

function restrictExistingComponentId(schema: JsonSchemaObject, componentIds: string[]): boolean {
  let restricted = false;
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return false;
  }

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const propertySchema = value as JsonSchemaObject;
    if (key === "component_id") {
      restrictComponentIdProperty(propertySchema, componentIds);
      restricted = true;
      continue;
    }
    restricted = restrictExistingComponentId(propertySchema, componentIds) || restricted;
  }

  return restricted;
}

function addComponentIdFallback(schema: JsonSchemaObject, componentIds: string[]) {
  schema.type ??= "object";
  const rootProperties = schemaProperties(schema);
  rootProperties.source_id ??= { type: "string", const: "component" };
  rootProperties.source ??= { type: "object" };

  const source = rootProperties.source;
  source.type ??= "object";
  const sourceProperties = schemaProperties(source);
  sourceProperties.component ??= { type: "object" };

  const component = sourceProperties.component;
  component.type ??= "object";
  const componentProperties = schemaProperties(component);
  componentProperties.component_id ??= {};
  restrictComponentIdProperty(componentProperties.component_id, componentIds);
}

function componentSourceSchema(
  sourceSchema: JsonSchemaObject,
  componentIds: string[],
): JsonSchemaObject {
  const schema = cloneSchema(sourceSchema);
  if (!restrictExistingComponentId(schema, componentIds)) {
    addComponentIdFallback(schema, componentIds);
  }
  return schema;
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
    .map((source) => componentSourceSchema(source.schema, matchedComponentIds));

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
    source_tree: cloneValue(activeMetadata.sourceTree),
    unsupported_sources: cloneValue(activeMetadata.unsupportedSources),
  };
  schema["x-dropsh-components"] = matchedComponents.map(componentMetadata);
  schema["x-dropsh-sources"] = cloneValue(activeMetadata.sources);

  return schema;
}
