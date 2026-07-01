#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Command } from "commander";
import { runAuthLogin, runAuthLogout, runAuthStatus, runAuthUse } from "./commands/auth.js";
import { runCreate } from "./commands/create.js";
import { runDelete } from "./commands/delete.js";
import { runRead } from "./commands/read.js";
import {
  applyOperationSchemaPlugins,
  operationHookPluginIds,
  runSchema,
  SCHEMA_PIPELINE_VERSION,
  schemaCacheMetadataMatches,
  siteCacheRoot,
} from "./commands/schema.js";
import { runSearch } from "./commands/search.js";
import { runUpdate } from "./commands/update.js";
import { runUploadFile } from "./commands/upload-file.js";
import {
  collectProviders,
  defaultProvider,
  providerById,
  sessionlessProvider,
} from "./core/auth/registry.js";
import { type ProfilesFile, readProfiles, writeProfile } from "./core/auth/session-store.js";
import type { AuthAdapter, AuthProvider, AuthStatusInfo } from "./core/auth/types.js";
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
import { AuthError, ConfigError, exitCodeFor } from "./errors.js";

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

export interface ResolveAuthDeps {
  baseUrl: string;
  plugins: DropSHPlugin[];
  http: HttpClient;
  now: () => number;
  stateDir?: string;
  /** Explicit profile from --auth-profile / $DROPSH_AUTH_PROFILE (highest precedence). */
  profile?: string;
}

/**
 * Choose the profile name to authenticate as. Precedence:
 *   explicit → stored `active` → config `default:true` → the sole provider.
 * Returns undefined when nothing selects a profile (caller then tries sessionless).
 */
function chooseProfile(
  providers: AuthProvider[],
  file: ProfilesFile | null,
  explicit?: string,
): string | undefined {
  if (explicit) return explicit;
  if (file?.active) return file.active;
  const def = defaultProvider(providers);
  if (def) return def.id;
  return providers.length === 1 ? providers[0]?.id : undefined;
}

export async function resolveAuth(deps: ResolveAuthDeps): Promise<AuthAdapter> {
  const providers = collectProviders(deps.plugins);
  const file = await readProfiles(deps.baseUrl, deps.stateDir);
  const name = chooseProfile(providers, file, deps.profile);
  if (name) {
    const provider = providerById(providers, name);
    if (!provider) throw new ConfigError(`auth profile '${name}' has no configured provider`);
    const rec = file?.profiles[name];
    if (rec) {
      return provider.createAdapter(rec.session, {
        http: deps.http,
        now: deps.now,
        save: (session) => writeProfile(deps.baseUrl, name, provider.id, session, deps.stateDir),
      });
    }
    // No stored session for the chosen profile: a login-less provider carries its
    // credentials inline; anything else needs an explicit login.
    if (provider.capabilities.login === false) {
      return provider.createAdapter(undefined, {
        http: deps.http,
        now: deps.now,
        save: async () => {},
      });
    }
    throw new AuthError(
      `Not authenticated for profile '${name}'. Run 'dropsh auth login --provider ${name}'.`,
    );
  }
  const sessionless = sessionlessProvider(providers);
  if (sessionless) {
    return sessionless.createAdapter(undefined, {
      http: deps.http,
      now: deps.now,
      save: async () => {},
    });
  }
  const ids = providers.map((p) => p.id).join(", ");
  throw new AuthError(
    `Multiple auth profiles configured (${ids}); none active. Run 'dropsh auth use <id>' or pass --auth-profile <id>.`,
  );
}

export interface AuthStatusDeps {
  baseUrl: string;
  plugins: DropSHPlugin[];
  stateDir?: string;
  profile?: string;
}

export async function authStatus(deps: AuthStatusDeps): Promise<AuthStatusInfo> {
  const providers = collectProviders(deps.plugins);
  const file = await readProfiles(deps.baseUrl, deps.stateDir);
  const name = chooseProfile(providers, file, deps.profile);
  if (!name) {
    const sessionless = sessionlessProvider(providers);
    return sessionless
      ? { loggedIn: true, provider: sessionless.id, sessionless: true }
      : { loggedIn: false };
  }
  const provider = providerById(providers, name);
  if (!provider) return { loggedIn: false };
  const rec = file?.profiles[name];
  if (!rec) {
    return provider.capabilities.login === false
      ? { loggedIn: true, provider: provider.id, sessionless: true }
      : { loggedIn: false, provider: provider.id };
  }
  return provider.status(rec.session);
}

async function defaultContext(configPath: string, profile?: string): Promise<CommandContext> {
  const cfg = await loadConfig(configPath);
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const auth = await resolveAuth({
    baseUrl: cfg.site.base_url,
    plugins: cfg.plugins,
    http,
    now: Date.now,
    ...(profile !== undefined ? { profile } : {}),
  });
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
    .option("--config <path>", "path to config file (overrides DROPSH_CONFIG)")
    .option(
      "--auth-profile <id>",
      "auth profile to use (overrides the active profile and $DROPSH_AUTH_PROFILE)",
    );

  const stdout = opts.stdout ?? ((s) => process.stdout.write(s));
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s));
  const setExitCode =
    opts.setExitCode ??
    ((c) => {
      process.exitCode = c;
    });
  const contextFactory =
    opts.contextFactory ??
    (() => {
      const o = program.opts();
      const profile = (o.authProfile as string | undefined) ?? process.env.DROPSH_AUTH_PROFILE;
      return defaultContext(resolveConfigPath(o.config as string | undefined), profile);
    });
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
      rootDir: siteCacheRoot(ctx.cwd, ctx.baseUrl),
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
    .command("use <id>")
    .description("Set the active auth profile for this host")
    .action((id: string) => run2(async () => runAuthUse({ profile: id }, await authDeps())));
  auth
    .command("logout")
    .description("Clear a stored session (default: the active profile)")
    .option("--profile <id>", "log out this profile instead of the active one")
    .option("--all", "clear every profile for this host")
    .action((o: { profile?: string; all?: boolean }) =>
      run2(async () => runAuthLogout(o, await authDeps())),
    );
  auth
    .command("status")
    .description("List auth profiles and their session state")
    .option("--json", "machine-readable output")
    .option("--profile <id>", "show only this profile")
    .action((o: { json?: boolean; profile?: string }) =>
      run2(async () => runAuthStatus(o, await authDeps())),
    );

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
