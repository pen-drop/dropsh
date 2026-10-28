import type { Command } from "commander";
import { CliError, exitCodeFor, type PluginCommandServices, readDataArg } from "dropsh/plugin";
import { buildArguments } from "./args.js";
import { createToolClient, type ToolClient, unknownToolError } from "./client.js";
import type { ToolOptions } from "./options.js";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorPayload(err: unknown) {
  return err instanceof CliError
    ? { error: { code: err.code, message: err.message, details: err.details } }
    : { error: { code: "E_UNKNOWN", message: (err as Error).message ?? String(err), details: {} } };
}

export function registerToolCommand(
  program: Command,
  services: PluginCommandServices,
  options: ToolOptions,
): void {
  program
    .command("tool [name]")
    .description("List, describe or call the site's Drupal Tool API tools over its MCP endpoint")
    .option("--schema", "print the tool's input (and output) schema")
    .option(
      "--param <key=value>",
      "tool argument; repeatable, overrides --data",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--data <json|@file>", "tool arguments as a JSON object, or @file")
    .action(
      async (
        name: string | undefined,
        flags: { schema?: boolean; param: string[]; data?: string },
      ) => {
        let client: ToolClient | undefined;
        try {
          const ctx = await services.getContext();
          client = createToolClient({
            auth: ctx.auth,
            baseUrl: ctx.baseUrl,
            endpoint: options.endpoint,
          });
          if (name === undefined) {
            const list = await client.list();
            print(list.map(({ name, title, description }) => ({ name, title, description })));
            return;
          }
          const tool = await client.get(name);
          if (!tool) throw unknownToolError(name, await client.list());
          if (flags.schema) {
            const { inputSchema, outputSchema } = tool;
            print({ name, inputSchema, outputSchema });
            return;
          }
          const data = flags.data === undefined ? undefined : await readDataArg(flags.data);
          const result = await client.call(
            name,
            buildArguments(tool.inputSchema, data, flags.param),
          );
          print(
            result.structuredContent ?? result.content.map((c) => (c.type === "text" ? c.text : c)),
          );
        } catch (err) {
          services.stderr(`${JSON.stringify(errorPayload(err))}\n`);
          process.exitCode = exitCodeFor(err);
        } finally {
          await client?.close();
        }
      },
    );
}
