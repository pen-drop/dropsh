import type { JsonApiClient, JsonApiDocument } from "dropsh/plugin";
import type { ReactElement } from "react";

export interface LinkDescriptor {
  route: string;
  params: Record<string, string>;
}

export interface BuildContext {
  viewMode: string;
  doc: JsonApiDocument;
  link(route: string, params: Record<string, string>): LinkDescriptor;
}

export type ViewModeMap = Record<string, { include?: string[] }>;

export interface ControllerContext {
  client: JsonApiClient;
  viewMode: string;
  seededDoc?: JsonApiDocument;
  navigate(route: string, params: Record<string, string>): void;
  resolveView(entityType: string, bundle?: string): EntityViewClass;
  resolveList(entityType: string, bundle?: string): EntityListClass;
}

export type TuiController = (
  params: Record<string, string>,
  ctx: ControllerContext,
) => Promise<ReactElement>;

export interface TuiRoute {
  name: string;
  path: string;
  controller: TuiController;
}

// Structural handler class shapes; concrete bases live in entity-view.tsx / entity-list.tsx.
export interface EntityViewClass {
  entityType: string;
  bundle?: string;
  viewModes: ViewModeMap;
  new (): {
    build(entity: import("dropsh/plugin").JsonApiResource, ctx: BuildContext): ReactElement;
  };
}
export interface EntityListClass {
  entityType: string;
  bundle?: string;
  new (): {
    build(resources: import("dropsh/plugin").JsonApiResource[], ctx: BuildContext): ReactElement;
  };
}
export type EntityHandlerClass = EntityViewClass | EntityListClass;

export interface TuiSubPlugin {
  id: string;
  entities?: EntityHandlerClass[];
  routes?: TuiRoute[];
}
