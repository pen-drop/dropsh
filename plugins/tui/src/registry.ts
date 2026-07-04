import type { JsonApiResource } from "dropsh/plugin";
import React from "react";
import { GenericEntityList, TuiEntityList } from "./entity-list.js";
import { GenericEntityView, TuiEntityView } from "./entity-view.js";
import type {
  ControllerContext,
  EntityListClass,
  EntityViewClass,
  TuiRoute,
  TuiSubPlugin,
} from "./types.js";

export interface Registry {
  resolveView(entityType: string, bundle?: string): EntityViewClass;
  resolveList(entityType: string, bundle?: string): EntityListClass;
  routes: Map<string, TuiRoute>;
}

function key(entityType: string, bundle?: string): string {
  return `${entityType}:${bundle ?? ""}`;
}

function isView(c: unknown): c is EntityViewClass {
  return typeof c === "function" && (c as typeof TuiEntityView).prototype instanceof TuiEntityView;
}
function isList(c: unknown): c is EntityListClass {
  return typeof c === "function" && (c as typeof TuiEntityList).prototype instanceof TuiEntityList;
}

function buildCtxLink(ctx: ControllerContext) {
  return {
    viewMode: ctx.viewMode,
    link: (route: string, params: Record<string, string>) => ({ route, params }),
  };
}

function coreRoutes(): TuiRoute[] {
  const canonical: TuiRoute = {
    name: "entity.canonical",
    path: "/{type}/{bundle}/{id}",
    controller: async (params, ctx) => {
      const ViewClass = ctx.resolveView(params.type as string, params.bundle);
      const doc =
        ctx.seededDoc ??
        (await ctx.client.get(
          params.bundle
            ? `${params.type}/${params.bundle}/${params.id}`
            : `${params.type}/${params.id}`,
        ));
      const entity = (Array.isArray(doc.data) ? doc.data[0] : doc.data) as JsonApiResource;
      const instance = new (
        ViewClass as unknown as { new (): { build: TuiEntityView["build"] } }
      )();
      return React.createElement(
        React.Fragment,
        null,
        instance.build(entity, { doc, ...buildCtxLink(ctx) }),
      );
    },
  };
  const collection: TuiRoute = {
    name: "entity.collection",
    path: "/{type}",
    controller: async (params, ctx) => {
      const ListClass = ctx.resolveList(params.type as string, params.bundle);
      const doc = ctx.seededDoc ?? (await ctx.client.get(params.type as string));
      const rows = (Array.isArray(doc.data) ? doc.data : [doc.data]) as JsonApiResource[];
      const instance = new (
        ListClass as unknown as { new (): { build: TuiEntityList["build"] } }
      )();
      return React.createElement(
        React.Fragment,
        null,
        instance.build(rows, { doc, ...buildCtxLink(ctx) }),
      );
    },
  };
  return [canonical, collection];
}

export function buildRegistry(plugins: TuiSubPlugin[]): Registry {
  const views = new Map<string, EntityViewClass>();
  const lists = new Map<string, EntityListClass>();
  const routes = new Map<string, TuiRoute>();

  for (const r of coreRoutes()) routes.set(r.name, r);

  for (const p of plugins) {
    for (const entity of p.entities ?? []) {
      if (isView(entity)) views.set(key(entity.entityType, entity.bundle), entity);
      else if (isList(entity)) lists.set(key(entity.entityType, entity.bundle), entity);
    }
    for (const route of p.routes ?? []) routes.set(route.name, route);
  }

  return {
    resolveView: (t, b) => views.get(key(t, b)) ?? views.get(key(t)) ?? GenericEntityView,
    resolveList: (t, b) => lists.get(key(t, b)) ?? lists.get(key(t)) ?? GenericEntityList,
    routes,
  };
}
