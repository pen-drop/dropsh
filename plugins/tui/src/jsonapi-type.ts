import type { JsonApiResource } from "dropsh/plugin";

// Splits a JSON:API type "node--article" into { entityType: "node", bundle: "article" }.
export function splitType(type: string): { entityType: string; bundle?: string } {
  const [entityType, bundle] = type.split("--") as [string, string?];
  return bundle ? { entityType, bundle } : { entityType };
}

// Best-effort human label for a resource: first string-valued title/name/label attribute, else id.
export function label(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  for (const key of ["title", "name", "label"]) {
    const v = attrs[key];
    if (typeof v === "string") return v;
  }
  return res.id;
}
