import type { JsonApiDocument } from "../jsonapi/types.js";

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
