import type {
  DrupalCliPlugin,
  JsonApiDocument,
  JsonApiResource,
  RenderContext,
  RenderServices,
} from "dropsh/plugin";
import { ConfigError } from "dropsh/plugin";
import { splitType } from "./jsonapi-type.js";
import { buildRegistry } from "./registry.js";
import { createRouter } from "./router.js";
import type { TuiSubPlugin } from "./types.js";

export { GenericEntityList, TuiEntityList } from "./entity-list.js";
export { GenericEntityView, TuiEntityView } from "./entity-view.js";
export { TuiLink } from "./link.js";
export type {
  BuildContext,
  LinkDescriptor,
  TuiController,
  TuiRoute,
  TuiSubPlugin,
  ViewModeMap,
} from "./types.js";

export interface TuiOptions {
  plugins?: TuiSubPlugin[];
}

function assertTty(isTty: boolean): void {
  if (!isTty) throw new ConfigError("--format tui requires an interactive terminal");
}

export function initialTarget(
  doc: JsonApiDocument,
  ctx: RenderContext,
): {
  route: string;
  params: Record<string, string>;
} {
  if (ctx.command === "search") {
    const params: Record<string, string> = { type: ctx.entityType ?? "" };
    if (ctx.bundle) params.bundle = ctx.bundle;
    return { route: "entity.collection", params };
  }
  const first = (Array.isArray(doc.data) ? doc.data[0] : doc.data) as JsonApiResource | undefined;
  const { entityType, bundle } = splitType(first?.type ?? "");
  const params: Record<string, string> = { type: entityType, id: first?.id ?? "" };
  if (bundle) params.bundle = bundle;
  return { route: "entity.canonical", params };
}

async function runTui(
  doc: JsonApiDocument,
  ctx: RenderContext,
  opts: TuiOptions,
  services?: RenderServices,
): Promise<void> {
  assertTty(Boolean(process.stdout.isTTY));
  if (!services) throw new ConfigError("--format tui requires runtime services (client)");
  const registry = buildRegistry(opts.plugins ?? []);
  const router = createRouter({
    registry,
    client: services.client,
    viewMode: ctx.viewMode ?? "default",
  });
  const target = initialTarget(doc, ctx);
  await router.navigate(target.route, target.params, doc);

  const [{ render }, React, { Browse }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./browse-app.js"),
  ]);
  const app = render(React.createElement(Browse, { router, onExit: () => app.unmount() }));
  await app.waitUntilExit();
}

export function tuiPlugin(tuiOpts: TuiOptions = {}): DrupalCliPlugin {
  return {
    id: "tui",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [
      {
        id: "tui",
        interactive: true,
        run: (doc, ctx, services) => runTui(doc, ctx, tuiOpts, services),
      },
    ],
  };
}
