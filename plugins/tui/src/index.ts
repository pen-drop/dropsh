import type { DrupalCliPlugin, JsonApiDocument, RenderContext } from "dropsh/plugin";
import { assertTty, resolveView, type TuiOptions } from "./views.js";

export type { TuiOptions, TuiViewConfig } from "./views.js";

async function runTui(doc: JsonApiDocument, ctx: RenderContext, opts: TuiOptions): Promise<void> {
  assertTty(Boolean(process.stdout.isTTY));
  const view = resolveView(opts, ctx.entityType ?? "", ctx.bundle);
  const [{ render }, React, { Browse }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./browse-app.js"),
  ]);
  const app = render(React.createElement(Browse, { doc, ctx, view }));
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
        run: (doc, ctx) => runTui(doc, ctx, tuiOpts),
      },
    ],
  };
}
