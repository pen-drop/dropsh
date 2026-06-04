import { join } from "node:path";
import type { AuthAdapter } from "../core/auth/types.js";
import { createFileStore } from "../core/cache/file-store.js";
import type { HttpClient } from "../core/http.js";
import type { DropSHPlugin } from "../core/plugin.js";
import { fetchCatalog } from "../core/schema/catalog.js";
import { fetchJsonSchema } from "../core/schema/jsonschema-source.js";
import { type Operation, toOperationVariant } from "../core/schema/to-jsonschema.js";
import { ValidationError } from "../errors.js";

export interface SchemaArgs {
  target?: string;
  operation: Operation;
  refresh: boolean;
}

export interface SchemaDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  cwd: string;
  emit: (v: unknown) => void;
  warn: (m: string) => void;
  plugins?: DropSHPlugin[];
}

export const SCHEMA_PIPELINE_VERSION = 2;

/**
 * Per-site schema cache root. Schemas differ between sites, so the cache is
 * namespaced by the site host — two configs pointing at different base_urls
 * from the same working directory must not share cached schemas.
 */
export function siteCacheRoot(cwd: string, baseUrl: string): string {
  const host = new URL(baseUrl).host.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
  return join(cwd, ".dropsh/cache", host);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function operationHookPluginIds(plugins: DropSHPlugin[]): string[] {
  return plugins.filter((plugin) => plugin.extendOperationSchema).map((plugin) => plugin.id);
}

export function schemaCacheMetadataMatches(
  schema: unknown,
  operationHookPlugins: string[],
): boolean {
  if (!isRecord(schema)) return false;
  if (schema["x-dropsh-schema-pipeline-version"] !== SCHEMA_PIPELINE_VERSION) return false;
  const cachedPlugins = schema["x-dropsh-operation-hook-plugins"];
  if (!Array.isArray(cachedPlugins)) return false;
  if (cachedPlugins.length !== operationHookPlugins.length) return false;
  return cachedPlugins.every((plugin, index) => plugin === operationHookPlugins[index]);
}

export async function applyOperationSchemaPlugins(
  schema: unknown,
  args: {
    entity: string;
    bundle: string;
    operation: Operation;
  },
  deps: {
    http: HttpClient;
    auth: AuthAdapter;
    baseUrl: string;
    plugins: DropSHPlugin[];
  },
): Promise<{ schema: unknown; extensions: string[] }> {
  let current = schema;
  const extensions: string[] = [];
  const ctx = { http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl };
  for (const plugin of deps.plugins) {
    if (!plugin.extendOperationSchema) continue;
    const extended = await plugin.extendOperationSchema(
      args.entity,
      args.bundle,
      args.operation,
      current,
      ctx,
    );
    if (extended !== current) {
      current = extended;
      extensions.push(plugin.id);
    }
  }
  return { schema: current, extensions };
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+$/;

export async function runSchema(args: SchemaArgs, deps: SchemaDeps): Promise<void> {
  const store = createFileStore({
    rootDir: siteCacheRoot(deps.cwd, deps.baseUrl),
    warn: deps.warn,
  });

  if (args.target === undefined) {
    if (!args.refresh) {
      const hit = await store.read<unknown>("catalog.json");
      if (hit !== undefined) {
        deps.emit(hit);
        return;
      }
    }
    const fresh = await fetchCatalog({
      http: deps.http,
      auth: deps.auth,
      baseUrl: deps.baseUrl,
      jsonapiPrefix: deps.jsonapiPrefix,
    });
    await store.write("catalog.json", fresh);
    deps.emit(fresh);
    return;
  }

  if (!TARGET_RE.test(args.target)) {
    throw new ValidationError(`target must be '<entity_type>/<bundle>', got '${args.target}'`);
  }
  // TARGET_RE guarantees two segments; non-null assertions are safe here.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const [entity, bundle] = args.target.split("/", 2) as [string, string];
  const cacheKey = `schema/${entity}--${bundle}.${args.operation}.json`;
  const plugins = deps.plugins ?? [];
  const hookPluginIds = operationHookPluginIds(plugins);

  if (!args.refresh) {
    const hit = await store.read<unknown>(cacheKey);
    if (hit !== undefined && schemaCacheMetadataMatches(hit, hookPluginIds)) {
      deps.emit(hit);
      return;
    }
  }

  const { schema: raw, source } = await fetchJsonSchema({
    http: deps.http,
    auth: deps.auth,
    baseUrl: deps.baseUrl,
    jsonapiPrefix: deps.jsonapiPrefix,
    entity,
    bundle,
    warn: deps.warn,
    plugins,
  });
  const transformed = toOperationVariant(raw, args.operation);
  const operationExtended = await applyOperationSchemaPlugins(
    transformed,
    { entity, bundle, operation: args.operation },
    {
      http: deps.http,
      auth: deps.auth,
      baseUrl: deps.baseUrl,
      plugins,
    },
  );

  const tagged = {
    ...(operationExtended.schema as Record<string, unknown>),
    "x-dropsh-source": source,
    "x-dropsh-target": { entity_type: entity, bundle },
    "x-dropsh-operation": args.operation,
    "x-dropsh-schema-extensions": operationExtended.extensions,
    "x-dropsh-schema-pipeline-version": SCHEMA_PIPELINE_VERSION,
    "x-dropsh-operation-hook-plugins": hookPluginIds,
  };

  await store.write(cacheKey, tagged);
  deps.emit(tagged);
}
