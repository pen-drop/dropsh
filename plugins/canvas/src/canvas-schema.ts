import type { SchemaOperation } from "dropsh/plugin";
import type { SdcComponent } from "./sdc-client.js";
import { toCanvasComponentId } from "./sdc-client.js";

type JsonSchemaObject = Record<string, any>;

function cloneSchema(schema: unknown): JsonSchemaObject {
  return JSON.parse(JSON.stringify(schema)) as JsonSchemaObject;
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

function componentInputVariants(components: SdcComponent[]): JsonSchemaObject[] {
  return components.map((component) => {
    const props = Object.keys(component.props).length > 0 ? component.props : {};

    return {
      ...props,
      type: "object",
      description: `Inputs for ${toCanvasComponentId(component.id)} (${component.name})`,
    };
  });
}

function componentMetadata(component: SdcComponent): JsonSchemaObject {
  return {
    id: toCanvasComponentId(component.id),
    source_id: component.id,
    name: component.name,
    description: component.description,
    provider: component.provider,
    status: component.status,
    props: component.props,
    slots: component.slots,
    variants: component.variants,
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
  const componentIds = components.map((component) => toCanvasComponentId(component.id)).sort();
  const knownSlots = slotNames(components);

  attributes.properties.components = {
    type: "array",
    description:
      "Canvas component tree. Root components use parent_uuid=null and slot=null. Child components set parent_uuid to another component uuid and slot to one of the parent's slot names.",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        uuid: { type: "string", format: "uuid" },
        component_id: { type: "string", enum: componentIds },
        parent_uuid: { type: ["string", "null"], format: "uuid" },
        slot: {
          type: ["string", "null"],
          description:
            knownSlots.length > 0
              ? `Known SDC slot names: ${knownSlots.join(", ")}. Use null for root components.`
              : "No SDC slots were reported by jsonapi_sdc. Use null for root components.",
        },
        inputs: {
          oneOf: componentInputVariants(components),
        },
        label: { type: ["string", "null"] },
      },
      required: ["uuid", "component_id", "inputs"],
    },
  };

  schema["x-dropsh-builder"] = "canvas";
  schema["x-dropsh-components"] = components.map(componentMetadata);

  return schema;
}
