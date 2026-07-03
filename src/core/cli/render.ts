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

export interface InteractiveRenderer {
  readonly id: string;
  readonly interactive: true;
  run(doc: JsonApiDocument, ctx: RenderContext): Promise<void>;
}

export type AnyRenderer = Renderer | InteractiveRenderer;

export function isInteractive(r: AnyRenderer): r is InteractiveRenderer {
  return "interactive" in r && r.interactive === true;
}
