#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Command } from "commander";
import { runCreate } from "./commands/create.js";
import { runDelete } from "./commands/delete.js";
import { runRead } from "./commands/read.js";
import { runSchema } from "./commands/schema.js";
import { runSearch } from "./commands/search.js";
import { runUpdate } from "./commands/update.js";
import { runUploadFile } from "./commands/upload-file.js";
import { createFileStore } from "./core/cache/file-store.js";
import { createOutput } from "./core/cli/output.js";
import type { RenderContext } from "./core/cli/render.js";
import { loadConfig } from "./core/config.js";
import { type CommandContext, createCommandContext } from "./core/context.js";
import type { JsonApiClient } from "./core/jsonapi/client.js";
import type { DrupalCliPlugin } from "./core/plugin.js";
import { fetchJsonSchema } from "./core/schema/jsonschema-source.js";
import type { Operation } from "./core/schema/to-jsonschema.js";
import { toOperationVariant } from "./core/schema/to-jsonschema.js";
import { validatePayload } from "./core/schema/validate.js";
import { ConfigError, exitCodeFor } from "./errors.js";

export type { CommandContext } from "./core/context.js";

export interface ProgramOptions {
  contextFactory?: () => Promise<CommandContext>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  setExitCode?: (code: number) => void;
  plugins?: DrupalCliPlugin[];
}

function resolveConfigPath(override?: string): string {
  return override ?? process.env.DROPSH_CONFIG ?? "dropsh.config.js";
}

// Normalizes a variadic --include option into a flat, trimmed list of field
// names: splits any comma-containing entries (so both `--include a,b` and
// `--include a b` work) and drops empty strings.
export function normalizeInclude(raw: string[] | undefined): string[] {
  if (!raw) return [];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function buildProgram(opts: ProgramOptions = {}): Command {
  const program = new Command();
  program
    .name("dropsh")
    .description("Entity-agnostic CLI for Drupal 11 JSON:API")
    .version("0.0.0")
    .option("--config <path>", "path to config file (overrides DROPSH_CONFIG)")
    .option("--format <id>", "output format: json (default) or a renderer id", "json");

  const stdout = opts.stdout ?? ((s) => process.stdout.write(s));
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s));
  const setExitCode =
    opts.setExitCode ??
    ((c) => {
      process.exitCode = c;
    });
  const contextFactory =
    opts.contextFactory ??
    (() => createCommandContext(resolveConfigPath(program.opts().config as string | undefined)));
  const renderers = (opts.plugins ?? []).flatMap((p) => p.renderers ?? []);
  const output = createOutput({
    stdout,
    stderr,
    renderers,
    getFormat: () => (program.opts().format as string | undefined) ?? "json",
  });

  async function run(
    fn: (ctx: CommandContext) => Promise<void>,
    precheck?: () => void,
  ): Promise<void> {
    try {
      precheck?.();
      const ctx = await contextFactory();
      await fn(ctx);
    } catch (err) {
      output.fail(err);
      setExitCode(exitCodeFor(err));
    }
  }

  function currentFormat(): string {
    return (program.opts().format as string | undefined) ?? "json";
  }
  function assertRenderable(): void {
    const f = currentFormat();
    if (!output.hasFormat(f)) {
      throw new ConfigError(
        `Unknown format '${f}'. Available: ${["json", ...renderers.map((r) => r.id)].join(", ")}`,
      );
    }
  }
  function assertJsonOnly(command: string): void {
    const f = currentFormat();
    if (f !== "json") {
      throw new ConfigError(`format '${f}' not applicable to command '${command}'`);
    }
  }

  async function loadOrFetchSchema(
    ctx: CommandContext,
    target: string,
    op: "create" | "update",
  ): Promise<unknown> {
    const store = createFileStore({
      rootDir: `${ctx.cwd}/.dropsh/cache`,
      warn: (m) => stderr(`${m}\n`),
    });
    const [entity, bundle] = target.split("/", 2) as [string, string];
    const key = `schema/${entity}--${bundle}.${op}.json`;
    const hit = await store.read<unknown>(key);
    if (hit !== undefined) return hit;
    const { schema: raw, source } = await fetchJsonSchema({
      http: ctx.http,
      auth: ctx.auth,
      baseUrl: ctx.baseUrl,
      jsonapiPrefix: ctx.jsonapiPrefix,
      entity,
      bundle,
      warn: (m) => stderr(`${m}\n`),
      plugins: ctx.plugins,
    });
    const transformed = toOperationVariant(raw, op);
    const tagged = {
      ...(transformed as Record<string, unknown>),
      "x-dropsh-source": source,
      "x-dropsh-target": { entity_type: entity, bundle },
      "x-dropsh-operation": op,
    };
    await store.write(key, tagged);
    return tagged;
  }

  program
    .command("read <target>")
    .description("Read entity_type/bundle/uuid")
    .option("--include <fields...>", "related fields to include (JSON:API include)")
    .action((target: string, o: { include?: string[] }) => {
      const [entityType, bundle] = target.split("/") as [string?, string?];
      const rctx: RenderContext = { command: "read", target };
      if (entityType !== undefined) rctx.entityType = entityType;
      if (bundle !== undefined) rctx.bundle = bundle;
      // biome-ignore lint/suspicious/noExplicitAny: optional include added conditionally
      const args = { target } as any;
      const include = normalizeInclude(o.include);
      if (include.length > 0) args.include = include;
      return run(
        (ctx) => runRead(args, { client: ctx.client, emit: (v) => output.emit(v, rctx) }),
        assertRenderable,
      );
    });

  program
    .command("search <entity_type>")
    .description("Search entities with filters")
    .option("--bundle <bundle>")
    .option("--filter <kv...>", "filter in key:value or key:op:value form", [])
    .option("--limit <n>", "max results", (v) => parseInt(v, 10), 50)
    .option("--include <fields...>", "related fields to include (JSON:API include)")
    .action(
      (
        entityType: string,
        o: { bundle?: string; filter: string[]; limit: number; include?: string[] },
      ) => {
        // biome-ignore lint/suspicious/noExplicitAny: optional bundle/include added conditionally
        const args = { entityType, filters: o.filter, limit: o.limit } as any;
        if (o.bundle !== undefined) args.bundle = o.bundle;
        const include = normalizeInclude(o.include);
        if (include.length > 0) args.include = include;
        const rctx: RenderContext = { command: "search", entityType };
        if (o.bundle !== undefined) rctx.bundle = o.bundle;
        return run(
          (ctx) => runSearch(args, { client: ctx.client, emit: (v) => output.emit(v, rctx) }),
          assertRenderable,
        );
      },
    );

  program
    .command("create <entity_type>")
    .description("Create an entity of given type/bundle")
    .requiredOption("--bundle <bundle>")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .option("--no-validate", "skip client-side schema validation")
    .action(
      (
        entityType: string,
        o: { bundle: string; data: string; dryRun?: boolean; validate?: boolean },
      ) => {
        const args: {
          entityType: string;
          bundle: string;
          dataArg: string;
          dryRun?: boolean;
          noValidate?: boolean;
        } = { entityType, bundle: o.bundle, dataArg: o.data };
        if (o.dryRun !== undefined) args.dryRun = o.dryRun;
        if (o.validate === false) args.noValidate = true;
        return run(async (ctx) => {
          const rctx: RenderContext = { command: "create", entityType, bundle: o.bundle };
          const deps: {
            client: JsonApiClient;
            emit: (v: unknown) => void;
            validate?: (payload: unknown, target: string) => void | Promise<void>;
          } = { client: ctx.client, emit: (v) => output.emit(v, rctx) };
          if (!args.noValidate) {
            deps.validate = async (payload: unknown, target: string) => {
              const schema = await loadOrFetchSchema(ctx, target, "create");
              validatePayload(schema, payload, target);
            };
          }
          await runCreate(args, deps);
        }, assertRenderable);
      },
    );

  program
    .command("update <target>")
    .description("Update an existing entity")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .option("--no-validate", "skip client-side schema validation")
    .action((target: string, o: { data: string; dryRun?: boolean; validate?: boolean }) => {
      const args: {
        target: string;
        dataArg: string;
        dryRun?: boolean;
        noValidate?: boolean;
      } = { target, dataArg: o.data };
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      if (o.validate === false) args.noValidate = true;
      return run(async (ctx) => {
        const [entityType, bundle] = target.split("/") as [string?, string?];
        const rctx: RenderContext = { command: "update", target };
        if (entityType !== undefined) rctx.entityType = entityType;
        if (bundle !== undefined) rctx.bundle = bundle;
        const deps: {
          client: JsonApiClient;
          emit: (v: unknown) => void;
          validate?: (payload: unknown, target: string) => void | Promise<void>;
        } = { client: ctx.client, emit: (v) => output.emit(v, rctx) };
        if (!args.noValidate) {
          deps.validate = async (payload: unknown, t: string) => {
            const schema = await loadOrFetchSchema(ctx, t, "update");
            validatePayload(schema, payload, t);
          };
        }
        await runUpdate(args, deps);
      }, assertRenderable);
    });

  program
    .command("delete <target>")
    .description("Delete an entity")
    .option("--dry-run")
    .action((target: string, o: { dryRun?: boolean }) => {
      // biome-ignore lint/suspicious/noExplicitAny: optional dryRun added conditionally
      const args = { target } as any;
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      return run(
        (ctx) => runDelete(args, { client: ctx.client, emit: output.emit }),
        () => assertJsonOnly("delete"),
      );
    });

  program
    .command("upload-file")
    .description("Upload a file to an entity's file/media field")
    .requiredOption("--target <target>", "entity_type/bundle/uuid/field_name")
    .requiredOption("--file <path>")
    .option("--dry-run")
    .action((o: { target: string; file: string; dryRun?: boolean }) => {
      // biome-ignore lint/suspicious/noExplicitAny: optional dryRun added conditionally
      const args = { target: o.target, file: o.file } as any;
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      return run(
        (ctx) => runUploadFile(args, { client: ctx.client, emit: output.emit }),
        () => assertJsonOnly("upload-file"),
      );
    });

  program
    .command("schema [target]")
    .description("Catalog (no target) or JSON Schema for <entity>/<bundle>")
    .option("--for <op>", "create|update", "create")
    .option("--refresh", "bypass cache for this call")
    .action((target: string | undefined, o: { for?: string; refresh?: boolean }) => {
      const operation: Operation = o.for === "update" ? "update" : "create";
      const schemaArgs =
        target !== undefined
          ? { target, operation, refresh: Boolean(o.refresh) }
          : { operation, refresh: Boolean(o.refresh) };
      return run(
        (ctx) =>
          runSchema(schemaArgs, {
            http: ctx.http,
            auth: ctx.auth,
            baseUrl: ctx.baseUrl,
            jsonapiPrefix: ctx.jsonapiPrefix,
            cwd: ctx.cwd,
            emit: output.emit,
            warn: (m) => stderr(`${m}\n`),
            plugins: ctx.plugins,
          }),
        () => assertJsonOnly("schema"),
      );
    });

  if (opts.plugins) {
    for (const plugin of opts.plugins) {
      plugin.registerCommands?.(program);
    }
  }

  program.exitOverride();

  return program;
}

function earlyConfigArg(argv: string[]): string | undefined {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: { config: { type: "string" } },
    strict: false,
  });
  return typeof values.config === "string" ? values.config : undefined;
}

export async function main(): Promise<void> {
  const configPath = resolveConfigPath(earlyConfigArg(process.argv));
  const cfg = await loadConfig(configPath).catch(() => null);
  const plugins = cfg?.plugins ?? [];
  const program = buildProgram({ plugins });
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if ((err as { code?: string }).code === "commander.helpDisplayed") return;
    process.exitCode = process.exitCode ?? 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
