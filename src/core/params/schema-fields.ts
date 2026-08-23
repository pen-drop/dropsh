export interface FieldDescriptor {
  name: string;
  kind: "attribute" | "relationship";
  /** The field's own subschema, as declared under attributes/relationships. */
  node: unknown;
  /** Relationship only: the resource types its `data.type` accepts. */
  targetTypes?: string[];
  /** Relationship only: true when `data` is an array. */
  multiple?: boolean;
}

export interface SchemaFieldIndex {
  /** From `data.properties.type.const`, else the first `enum` entry. */
  resourceType?: string;
  fields: Map<string, FieldDescriptor>;
  /** Schema declaration order: attributes first, then relationships. */
  order: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `properties` map of a schema node, or undefined when it has none. */
export function propertiesOf(node: unknown): Record<string, unknown> | undefined {
  if (!isRecord(node)) return undefined;
  const props = node.properties;
  return isRecord(props) ? props : undefined;
}

function resourceTypeOf(dataNode: unknown): string | undefined {
  const typeNode = propertiesOf(dataNode)?.type;
  if (!isRecord(typeNode)) return undefined;
  if (typeof typeNode.const === "string") return typeNode.const;
  if (Array.isArray(typeNode.enum) && typeof typeNode.enum[0] === "string") {
    return typeNode.enum[0];
  }
  return undefined;
}

/**
 * A relationship declares its payload under `data`, either as a single resource
 * identifier object or as an array of them. Both carry the allowed resource
 * types in their `type` node's `enum`/`const`, which is what lets a bare UUID on
 * the command line become a complete identifier object.
 */
function describeRelationship(name: string, node: unknown): FieldDescriptor {
  const dataNode = propertiesOf(node)?.data;
  const multiple = isRecord(dataNode) && dataNode.type === "array";
  const itemNode = multiple ? (dataNode as Record<string, unknown>).items : dataNode;
  const typeNode = propertiesOf(itemNode)?.type;
  let targetTypes: string[] | undefined;
  if (isRecord(typeNode)) {
    if (Array.isArray(typeNode.enum)) {
      targetTypes = typeNode.enum.filter((t): t is string => typeof t === "string");
    } else if (typeof typeNode.const === "string") {
      targetTypes = [typeNode.const];
    }
  }
  return {
    name,
    kind: "relationship",
    node,
    multiple,
    ...(targetTypes !== undefined ? { targetTypes } : {}),
  };
}

export function indexSchemaFields(schema: unknown): SchemaFieldIndex {
  const dataNode = propertiesOf(schema)?.data;
  const dataProps = propertiesOf(dataNode);
  const fields = new Map<string, FieldDescriptor>();
  const order: string[] = [];

  for (const [name, node] of Object.entries(propertiesOf(dataProps?.attributes) ?? {})) {
    fields.set(name, { name, kind: "attribute", node });
    order.push(name);
  }
  for (const [name, node] of Object.entries(propertiesOf(dataProps?.relationships) ?? {})) {
    fields.set(name, describeRelationship(name, node));
    order.push(name);
  }

  const resourceType = resourceTypeOf(dataNode);
  return { fields, order, ...(resourceType !== undefined ? { resourceType } : {}) };
}
