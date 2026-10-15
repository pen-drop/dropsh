import { ValidationError } from "dropsh/plugin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrite document-local `$ref` pointers so they stay valid after `schema` is
 * embedded at `basePointer` (a JSON Pointer from the combined document root).
 * External or opaque references fail instead of being dropped.
 */
export function rebaseLocalRefs(schema: unknown, basePointer: string): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => rebaseLocalRefs(item, basePointer));
  }
  if (!isRecord(schema)) return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$ref" && typeof value === "string") {
      out[key] = rebaseRef(value, basePointer);
    } else {
      out[key] = rebaseLocalRefs(value, basePointer);
    }
  }
  return out;
}

function rebaseRef(ref: string, basePointer: string): string {
  if (ref === "#") return basePointer;
  if (ref.startsWith("#/")) {
    return `${basePointer}${ref.slice(1)}`;
  }
  throw new ValidationError(`unsupported $ref '${ref}'`);
}
