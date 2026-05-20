import { HttpError, ValidationError } from "../../errors.js";
import type { AuthAdapter } from "../auth/types.js";
import type { HttpClient } from "../http.js";
import type { DropSHPlugin, PluginContext } from "../plugin.js";
import { fetchHeuristic } from "./sources/heuristic.js";

export type SchemaSource = "heuristic" | "heuristic-empty" | (string & {});

export interface JsonSchemaResult {
  schema: unknown;
  source: SchemaSource;
  target: { entity_type: string; bundle: string };
}

export interface JsonSchemaDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  entity: string;
  bundle: string;
  warn: (message: string) => void;
  plugins?: DropSHPlugin[];
}

export async function fetchJsonSchema(deps: JsonSchemaDeps): Promise<JsonSchemaResult> {
  const { entity, bundle } = deps;
  const target = { entity_type: entity, bundle };
  const plugins = deps.plugins ?? [];
  const ctx: PluginContext = { http: deps.http, auth: deps.auth, baseUrl: deps.baseUrl };

  // Build heuristic base schema
  let heuristicResult: Awaited<ReturnType<typeof fetchHeuristic>>;
  try {
    heuristicResult = await fetchHeuristic({
      http: deps.http,
      auth: deps.auth,
      baseUrl: deps.baseUrl,
      jsonapiPrefix: deps.jsonapiPrefix,
      entity,
      bundle,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new ValidationError(
        `no such target '${entity}/${bundle}'. Run 'dropsh schema' to see available targets.`,
        { entity, bundle },
      );
    }
    throw err;
  }

  let schema: unknown = heuristicResult.schema;
  let source: SchemaSource = heuristicResult.empty ? "heuristic-empty" : "heuristic";

  // Run each plugin's extendSchema — a plugin may replace the schema entirely (e.g. schemata)
  for (const plugin of plugins) {
    const extended = await plugin.extendSchema(entity, bundle, schema, ctx);
    if (extended !== schema) {
      schema = extended;
      source = plugin.id;
    }
  }

  // Only warn when no plugin improved the schema
  if (source === "heuristic" || source === "heuristic-empty") {
    if (heuristicResult.empty) {
      deps.warn(
        `warning: bundle '${entity}/${bundle}' has no instances and no schema plugin; returning envelope-only schema`,
      );
    } else {
      deps.warn(
        `warning: no schema plugin configured; returning heuristic schema (no required fields, no constraints)`,
      );
    }
  }

  return { schema, source, target };
}
