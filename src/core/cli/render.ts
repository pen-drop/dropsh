import type { JsonApiDocument, JsonApiResource } from "../jsonapi/types.js";

// Indexes a document's `included` resources by `${type}/${id}` so renderers can
// resolve a relationship reference to its embedded resource (populated by
// `--include`). Empty map when the document carries no `included`.
export function indexIncluded(doc: JsonApiDocument): Map<string, JsonApiResource> {
  const map = new Map<string, JsonApiResource>();
  for (const r of doc.included ?? []) {
    map.set(`${r.type}/${r.id}`, r);
  }
  return map;
}

export interface RenderContext {
  command: "read" | "search" | "create" | "update";
  target?: string;
  entityType?: string;
  bundle?: string;
}

export interface Renderer {
  readonly id: string;
  render(doc: JsonApiDocument, ctx: RenderContext): string;
}
