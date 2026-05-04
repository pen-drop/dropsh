export type Operation = "create" | "update";

const VALID_TYPES = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

function normalizeTypes(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normalizeTypes);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "type") {
      if (typeof v === "string") {
        if (VALID_TYPES.has(v)) out[k] = v;
        // else: drop Drupal-specific non-standard type string
      } else if (Array.isArray(v)) {
        const valid = v.filter((t): t is string => typeof t === "string" && VALID_TYPES.has(t));
        if (valid.length > 0) out[k] = valid.length === 1 ? valid[0] : valid;
        // else: drop all-invalid type array
      } else {
        out[k] = normalizeTypes(v);
      }
    } else {
      out[k] = normalizeTypes(v);
    }
  }
  return out;
}

export function toOperationVariant(schema: unknown, op: Operation): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: deep JSON structure from external schemata source
  const cloned = JSON.parse(JSON.stringify(normalizeTypes(schema))) as Record<string, any>;
  const data = cloned?.properties?.data;
  if (data && typeof data === "object") {
    if (op === "create") {
      // id is server-assigned on create; strip it from required even if schemata includes it
      if (Array.isArray(data.required)) {
        data.required = (data.required as string[]).filter((r) => r !== "id");
      }
    } else {
      data.required = ["type", "id"];
      if (data.properties?.attributes) data.properties.attributes.required = [];
      if (data.properties?.relationships) data.properties.relationships.required = [];
    }
  }
  return cloned;
}
