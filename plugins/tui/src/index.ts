import { createCommandContext, type DrupalCliPlugin } from "dropsh/plugin";
import { assertTty, resolveView, type TuiOptions } from "./views.js";

export type { TuiOptions, TuiViewConfig } from "./views.js";

export function tuiPlugin(tuiOpts: TuiOptions = {}): DrupalCliPlugin {
  return {
    id: "tui",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    registerCommands(program) {
      program
        .command("browse <entity_type>")
        .description("Interactively browse entities in a full-screen TUI")
        .option("--bundle <bundle>")
        .action(async (entityType: string, o: { bundle?: string }) => {
          try {
            assertTty(Boolean(process.stdout.isTTY));
            const configPath =
              (program.opts().config as string | undefined) ??
              process.env.DROPSH_CONFIG ??
              "dropsh.config.js";
            const ctx = await createCommandContext(configPath);
            const view = resolveView(tuiOpts, entityType, o.bundle);
            const [{ render }, React, { Browse }] = await Promise.all([
              import("ink"),
              import("react"),
              import("./browse-app.js"),
            ]);
            const props = {
              client: ctx.client,
              entityType,
              view,
              ...(o.bundle !== undefined ? { bundle: o.bundle } : {}),
            };
            const app = render(React.createElement(Browse, props));
            await app.waitUntilExit();
          } catch (err) {
            const code = (err as { code?: string }).code === "E_CONFIG" ? "E_CONFIG" : "E_UNKNOWN";
            process.stderr.write(
              `${JSON.stringify({
                error: { code, message: (err as Error).message ?? String(err), details: {} },
              })}\n`,
            );
            process.exitCode = code === "E_CONFIG" ? 2 : 1;
          }
        });
    },
  };
}
