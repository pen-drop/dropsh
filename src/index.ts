#!/usr/bin/env node
import { Command } from "commander";
import { createHttpClient } from "./core/http.js";
import { loadConfig } from "./core/config.js";
import { createAuthAdapter } from "./core/auth/factory.js";
import { createJsonApiClient, type JsonApiClient } from "./core/jsonapi/client.js";
import { createOutput } from "./core/cli/output.js";
import { exitCodeFor } from "./errors.js";
import { runRead } from "./commands/read.js";
import { runSearch } from "./commands/search.js";
import { runCreate } from "./commands/create.js";
import { runUpdate } from "./commands/update.js";
import { runDelete } from "./commands/delete.js";
import { runUploadFile } from "./commands/upload-file.js";
import { runLogin } from "./commands/login.js";

export interface CommandContext {
  client: JsonApiClient;
}

export interface ProgramOptions {
  contextFactory?: () => Promise<CommandContext>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  setExitCode?: (code: number) => void;
}

async function defaultContext(): Promise<CommandContext> {
  const cfg = await loadConfig(process.env.DRUPAL_CLI_CONFIG ?? ".drupal-cli.yml");
  const http = createHttpClient({ timeoutMs: cfg.defaults.timeout_ms });
  const auth = createAuthAdapter(cfg.site.auth, { http, baseUrl: cfg.site.base_url });
  const client = createJsonApiClient({
    baseUrl: cfg.site.base_url,
    prefix: cfg.site.jsonapi_prefix,
    http,
    auth,
  });
  return { client };
}

export function buildProgram(opts: ProgramOptions = {}): Command {
  const program = new Command();
  program.name("drupal-cli").description("Entity-agnostic CLI for Drupal 11 JSON:API").version("0.0.0");

  const stdout = opts.stdout ?? ((s) => process.stdout.write(s));
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s));
  const setExitCode = opts.setExitCode ?? ((c) => {
    process.exitCode = c;
  });
  const contextFactory = opts.contextFactory ?? defaultContext;
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

  program
    .command("read <target>")
    .description("Read entity_type/bundle/uuid")
    .action((target: string) => run((ctx) => runRead({ target }, { client: ctx.client, emit: output.emit })));

  program
    .command("search <entity_type>")
    .description("Search entities with filters")
    .option("--bundle <bundle>")
    .option("--filter <kv...>", "filter in key:value or key:op:value form", [])
    .option("--limit <n>", "max results", (v) => parseInt(v, 10), 50)
    .action((entityType: string, o: { bundle?: string; filter: string[]; limit: number }) => {
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
    .action((entityType: string, o: { bundle: string; data: string; dryRun?: boolean }) => {
      const args = { entityType, bundle: o.bundle, dataArg: o.data } as any;
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      run((ctx) => runCreate(args, { client: ctx.client, emit: output.emit }));
    });

  program
    .command("update <target>")
    .description("Update an existing entity")
    .requiredOption("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .action((target: string, o: { data: string; dryRun?: boolean }) => {
      const args = { target, dataArg: o.data } as any;
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      run((ctx) => runUpdate(args, { client: ctx.client, emit: output.emit }));
    });

  program
    .command("delete <target>")
    .description("Delete an entity")
    .option("--dry-run")
    .action((target: string, o: { dryRun?: boolean }) => {
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
      const args = { target: o.target, file: o.file } as any;
      if (o.dryRun !== undefined) args.dryRun = o.dryRun;
      run((ctx) => runUploadFile(args, { client: ctx.client, emit: output.emit }));
    });

  program
    .command("login")
    .description("Authenticate via OAuth 2.0 Authorization Code + PKCE")
    .action(async () => {
      try {
        await runLogin({ stdout: (s) => process.stdout.write(`${s}\n`) });
      } catch (err) {
        output.fail(err);
        setExitCode(exitCodeFor(err));
      }
    });

  program.exitOverride();

  return program;
}

export async function main(): Promise<void> {
  const program = buildProgram();
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
