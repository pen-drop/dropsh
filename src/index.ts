#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Command } from "commander";
import { runAuthLogin, runAuthLogout, runAuthStatus } from "./commands/auth.js";
import { runCreate } from "./commands/create.js";
import { runDelete } from "./commands/delete.js";
import { runRead } from "./commands/read.js";
import {
  applyOperationSchemaPlugins,
  operationHookPluginIds,
  runSchema,
  SCHEMA_PIPELINE_VERSION,
  schemaCacheMetadataMatches,
} from "./commands/schema.js";
import { runSearch } from "./commands/search.js";
import { runUpdate } from "./commands/update.js";
import { runUploadFile } from "./commands/upload-file.js";
import { collectProviders } from "./core/auth/registry.js";
import type { AuthAdapter } from "./core/auth/types.js";
import { createFileStore } from "./core/cache/file-store.js";
import { createOutput } from "./core/cli/output.js";
import { createPrompt } from "./core/cli/prompt.js";
import { loadConfig } from "./core/config.js";
import type { HttpClient } from "./core/http.js";
import { createHttpClient } from "./core/http.js";
import { createJsonApiClient, type JsonApiClient } from "./core/jsonapi/client.js";
import type { DropSHPlugin } from "./core/plugin.js";
import { fetchJsonSchema } from "./core/schema/jsonschema-source.js";
import type { Operation } from "./core/schema/to-jsonschema.js";
import { toOperationVariant } from "./core/schema/to-jsonschema.js";
import { validatePayload } from "./core/schema/validate.js";
import { ConfigError, exitCodeFor } from "./errors.js";

export interface CommandContext {
  client: JsonApiClient;
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  plugins: DropSHPlugin[];
}

export interface ProgramOptions {
  contextFactory?: () => Promise<CommandContext>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  setExitCode?: (code: number) => void;
  plugins?: DropSHPlugin[];
}

function resolveConfigPath(override?: string): string {
  return override ?? process.env.DROPSH_CONFIG ?? "dropsh.config.js";
}

async function defaultContext(configPath: string): Promise<CommandContext> {
  const cfg = await loadConfig(configPath);
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const authPlugin = cfg.plugins.find((p) => p.createAuthAdapter);
  if (!authPlugin?.createAuthAdapter) {
    throw new ConfigError(
      "No auth plugin configured. Add basicAuthPlugin() or oauth2Plugin() to config.plugins.",
    );
  }
  const auth = authPlugin.createAuthAdapter();
  const client = createJsonApiClient({
    baseUrl: cfg.site.base_url,
    prefix: cfg.site.jsonapi_prefix,
    http,
    auth,
  });
  return {
    client,
    http,
    auth,
    baseUrl: cfg.site.base_url,
    jsonapiPrefix: cfg.site.jsonapi_prefix,
    cwd: process.cwd(),
    plugins: cfg.plugins,
  };
}

export function buildProgram(opts: ProgramOptions = {}): Command {
  const program = new Command();
  program
    .name("dropsh")
    .description("Entity-agnostic CLI for Drupal 11 JSON:API")
    .version("0.0.0")
    .option("--config <path>", "path to config file (overrides DROPSH_CONFIG)");

  const stdout = opts.stdout ?? ((s) => process.stdout.write(s));
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s));
  const setExitCode =
    opts.setExitCode ??
    ((c) => {
      process.exitCode = c;
    });
  const contextFactory =
    opts.contextFactory ??
    (() => defaultContext(resolveConfigPath(program.opts().config as string | undefined)));
  const output = createOutput({ stdout, stderr });

  async function run(fn: (ctx: CommandContext) => Promise<void>): Promise<void> {
    try {
      const ctx = await contextFactory();
      await fn(ctx);
    } catch (err) {
      output.fail(err);
      setExitCode(exitCodeFor(err));
    }
  }

  async function run2(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      output.fail(err);
      setExitCode(exitCodeFor(err));
    }
  }

  async function authDeps(): Promise<import("./commands/auth.js").AuthDeps> {
    const cfg = await loadConfig(resolveConfigPath(program.opts().config as string | undefined));
    return {
      baseUrl: cfg.site.base_url,
      providers: collectProviders(cfg.plugins),
      stdout,
      stderr,
      prompt: createPrompt(),
      openBrowser: async (url: string) => {
        const { default: open } = await import("open");
        await open(url);
      },
      http: createHttpClient({ timeoutMs: cfg.defaults.timeout_ms }),
      now: Date.now,
      isTTY: Boolean(process.stdin.isTTY),
    };
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
    const hookPluginIds = operationHookPluginIds(ctx.plugins);
    const hit = await store.read<unknown>(key);
    if (hit !== undefined && schemaCacheMetadataMatches(hit, hookPluginIds)) return hit;
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
    const operationExtended = await applyOperationSchemaPlugins(
      transformed,
      { entity, bundle, operation: op },
      {
        http: ctx.http,
        auth: ctx.auth,
        baseUrl: ctx.baseUrl,
        plugins: ctx.plugins,
      },
    );
    const tagged = {
      ...(operationExtended.schema as Record<string, unknown>),
      "x-dropsh-source": source,
      "x-dropsh-target": { entity_type: entity, bundle },
      "x-dropsh-operation": op,
      "x-dropsh-schema-extensions": operationExtended.extensions,
      "x-dropsh-schema-pipeline-version": SCHEMA_PIPELINE_VERSION,
      "x-dropsh-operation-hook-plugins": hookPluginIds,
    };
    await store.write(key, tagged);
    return tagged;
  }

  program
    .command("read <target>")
    .description("Read entity_type/bundle/uuid")
    .action((target: string) =>
      run((ctx) => runRead({ target }, { client: ctx.client, emit: output.emit })),
    );

  program
    .command("search <entity_type>")
    .description("Search entities with filters")
    .option("--bundle <bundle>")
    .option("--filter <kv...>", "filter in key:value or key:op:value form", [])
    .option("--limit <n>", "max results", (v) => parseInt(v, 10), 50)
    .action((entityType: string, o: { bundle?: string; filter: string[]; limit: number }) => {
      // biome-ignore lint/suspicious/noExplicitAny: optional bundle added conditionally
      const args = { entityType, filters: o.filter, limit: o.limit } as any;
      if (o.bundle !== undefined) args.bundle = o.bundle;
      run((ctx) => runSearch(args, { client: ctx.client, emit: output.emit }));
    });

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
        run(async (ctx) => {
          const deps: {
            client: JsonApiClient;
            emit: (v: unknown) => void;
            validate?: (payload: unknown, target: string) => void | Promise<void>;
          } = { client: ctx.client, emit: output.emit };
          if (!args.noValidate) {
            deps.validate = async (payload: unknown, target: string) => {
              const schema = await loadOrFetchSchema(ctx, target, "create");
              validatePayload(schema, payload, target);
            };
          }
          await runCreate(args, deps);
        });
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
      run(async (ctx) => {
        const deps: {
          client: JsonApiClient;
          emit: (v: unknown) => void;
          validate?: (payload: unknown, target: string) => void | Promise<void>;
        } = { client: ctx.client, emit: output.emit };
        if (!args.noValidate) {
          deps.validate = async (payload: unknown, t: string) => {
            const schema = await loadOrFetchSchema(ctx, t, "update");
            validatePayload(schema, payload, t);
          };
        }
        await runUpdate(args, deps);
      });
    });

  program
    .command("delete <target>")
    .description("Delete an entity")
    .option("--dry-run")
    .action((target: string, o: { dryRun?: boolean }) => {
      // biome-ignore lint/suspicious/noExplicitAny: optional dryRun added conditionally
      const args = { target } as any;
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      run((ctx) => runDelete(args, { client: ctx.client, emit: output.emit }));
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
      run((ctx) => runUploadFile(args, { client: ctx.client, emit: output.emit }));
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
      run((ctx) =>
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
      );
    });

  const auth = program.command("auth").description("Manage authentication");
  auth
    .command("login")
    .description("Log in via an auth provider")
    .option("--provider <id>", "skip the picker and use this provider id")
    .action((o: { provider?: string }) =>
      run2(async () => runAuthLogin(o.provider ? { provider: o.provider } : {}, await authDeps())),
    );
  auth
    .command("logout")
    .description("Clear the active session")
    .action(() => run2(async () => runAuthLogout({}, await authDeps())));
  auth
    .command("status")
    .description("Show the active session")
    .option("--json", "machine-readable output")
    .action((o: { json?: boolean }) => run2(async () => runAuthStatus(o, await authDeps())));

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
