import { join } from "node:path";
import type { AuthAdapter } from "../core/auth/types.js";
import { createFileStore } from "../core/cache/file-store.js";
import type { HttpClient } from "../core/http.js";
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
}

const TARGET_RE = /^[a-z0-9_]+\/[a-z0-9_]+$/;

export async function runSchema(args: SchemaArgs, deps: SchemaDeps): Promise<void> {
  const store = createFileStore({ rootDir: join(deps.cwd, ".drupal-cli/cache"), warn: deps.warn });

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

  if (!args.refresh) {
    const hit = await store.read<unknown>(cacheKey);
    if (hit !== undefined) {
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
  });
  const transformed = toOperationVariant(raw, args.operation);

  const tagged = {
    ...(transformed as Record<string, unknown>),
    "x-drupal-cli-source": source,
    "x-drupal-cli-target": { entity_type: entity, bundle },
    "x-drupal-cli-operation": args.operation,
  };

  await store.write(cacheKey, tagged);
  deps.emit(tagged);
}
