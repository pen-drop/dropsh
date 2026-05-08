import type { SchemaOperation } from "dropsh/plugin";
import type { SdcComponent } from "./sdc-client.js";
import { toCanvasComponentId } from "./sdc-client.js";

type JsonSchemaObject = Record<string, any>;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSchema(schema: unknown): JsonSchemaObject {
  return cloneValue(schema) as JsonSchemaObject;
}

function ensureObjectProperty(parent: JsonSchemaObject, key: string): JsonSchemaObject {
  parent.properties ??= {};
  parent.properties[key] ??= { type: "object" };

  const child = parent.properties[key] as JsonSchemaObject;
  child.type ??= "object";
  child.properties ??= {};
  return child;
}

function slotNames(components: SdcComponent[]): string[] {
  return [...new Set(components.flatMap((component) => Object.keys(component.slots)))].sort();
}

function inputSchema(component: SdcComponent): JsonSchemaObject {
  const props =
    Object.keys(component.props).length > 0
      ? cloneValue(component.props)
      : { properties: {}, additionalProperties: true };

  return {
    ...props,
    type: "object",
    description: `Inputs for ${toCanvasComponentId(component.id)} (${component.name})`,
  };
}

function slotSchema(knownSlots: string[]): JsonSchemaObject {
  return {
    type: ["string", "null"],
    enum: knownSlots.length > 0 ? [null, ...knownSlots] : [null],
    description:
      knownSlots.length > 0
        ? `Known SDC slot names: ${knownSlots.join(", ")}. Use null for root components.`
        : "No SDC slots were reported by jsonapi_sdc. Use null for root components.",
  };
}

function componentItemVariant(component: SdcComponent, knownSlots: string[]): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      uuid: { type: "string", format: "uuid" },
      component_id: { type: "string", const: toCanvasComponentId(component.id) },
      parent_uuid: { type: ["string", "null"], format: "uuid" },
      slot: slotSchema(knownSlots),
      inputs: inputSchema(component),
      label: { type: ["string", "null"] },
    },
    required: ["uuid", "component_id", "inputs"],
  };
}

function componentMetadata(component: SdcComponent): JsonSchemaObject {
  return {
    id: toCanvasComponentId(component.id),
    source_id: component.id,
    name: component.name,
    description: component.description,
    provider: component.provider,
    status: component.status,
    props: cloneValue(component.props),
    slots: cloneValue(component.slots),
    variants: cloneValue(component.variants),
  };
}

export function extendCanvasSchema(
  baseSchema: unknown,
  operation: SchemaOperation,
  components: SdcComponent[],
): unknown {
  const schema = cloneSchema(baseSchema);
  const data = ensureObjectProperty(schema, "data");
  if (operation === "update") {
    data.required = ["type", "id"];
  }

  const attributes = ensureObjectProperty(data, "attributes");
  const knownSlots = slotNames(components);
  const componentItemVariants = [...components]
    .sort((a, b) => toCanvasComponentId(a.id).localeCompare(toCanvasComponentId(b.id)))
    .map((component) => componentItemVariant(component, knownSlots));

  attributes.properties.components = {
    type: "array",
    description:
      "Canvas component tree. Root components use parent_uuid=null and slot=null. Child components set parent_uuid to another component uuid and slot to one of the parent's slot names.",
    items: {
      oneOf: componentItemVariants,
    },
  };

  schema["x-dropsh-builder"] = "canvas";
  schema["x-dropsh-components"] = components.map(componentMetadata);

  return schema;
}
