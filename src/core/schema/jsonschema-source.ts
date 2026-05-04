import { HttpError, ValidationError } from "../../errors.js";
import type { AuthAdapter } from "../auth/types.js";
import type { HttpClient } from "../http.js";
import { fetchHeuristic } from "./sources/heuristic.js";
import { fetchSchemata, SCHEMATA_MISS } from "./sources/schemata.js";

export type SchemaSource = "schemata" | "heuristic" | "heuristic-empty";

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
}

export async function fetchJsonSchema(deps: JsonSchemaDeps): Promise<JsonSchemaResult> {
  const { entity, bundle } = deps;
  const target = { entity_type: entity, bundle };

  let schematic: unknown | typeof SCHEMATA_MISS = SCHEMATA_MISS;
  try {
    schematic = await fetchSchemata({
      http: deps.http,
      auth: deps.auth,
      baseUrl: deps.baseUrl,
      entity,
      bundle,
    });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    // Any HttpError (e.g. 500 for unknown bundle) is treated as a miss; fall through to heuristic.
  }
  if (schematic !== SCHEMATA_MISS) {
    return { schema: schematic, source: "schemata", target };
  }

  // Fallback: heuristic
  let heuristic: Awaited<ReturnType<typeof fetchHeuristic>>;
  try {
    heuristic = await fetchHeuristic({
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
        `no such target '${entity}/${bundle}'. Run 'drupal-cli schema' to see available targets.`,
        { entity, bundle },
      );
    }
    throw err;
  }

  if (heuristic.empty) {
    deps.warn(
      `warning: bundle '${entity}/${bundle}' has no instances and no 'schemata' module; returning envelope-only schema`,
    );
    return { schema: heuristic.schema, source: "heuristic-empty", target };
  }

  deps.warn(
    `warning: site has no 'schemata' module; returning heuristic schema (no required fields, no constraints)`,
  );
  return { schema: heuristic.schema, source: "heuristic", target };
}
