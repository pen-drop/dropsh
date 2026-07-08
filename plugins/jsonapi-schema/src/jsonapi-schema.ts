import type { AuthAdapter, HttpClient } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";

/** Sentinel returned when the jsonapi_schema route is absent (HTTP 404). */
export const JSONAPI_SCHEMA_MISS = Symbol("JSONAPI_SCHEMA_MISS");

export interface FetchJsonapiSchemaDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  entity: string;
  bundle: string;
}

/**
 * Fetch the resource-object schema for a bundle from the jsonapi_schema module.
 *
 * Route (dynamic, registered by jsonapi_schema): the resource-object schema
 * lives at `{jsonapiPrefix}/{entity}/{bundle}/resource/schema`. It describes a
 * single JSON:API resource object (type + attributes + relationships), which is
 * exactly what a create/update payload's `data` member must satisfy.
 *
 * Returns the parsed schema on 200, {@link JSONAPI_SCHEMA_MISS} on 404 (module
 * or route absent), and throws on any other HTTP status (a broken endpoint must
 * be surfaced, never silently swallowed) or an unparseable body.
 */
export async function fetchJsonapiSchema(
  deps: FetchJsonapiSchemaDeps,
): Promise<unknown | typeof JSONAPI_SCHEMA_MISS> {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const prefix = `/${deps.jsonapiPrefix.replace(/^\/+|\/+$/g, "")}`;
  const url = `${base}${prefix}/${deps.entity}/${deps.bundle}/resource/schema`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
  });
  let res: Awaited<ReturnType<typeof deps.http.send>>;
  try {
    res = await deps.http.send(req);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return JSONAPI_SCHEMA_MISS;
    throw err;
  }
  return JSON.parse(res.body);
}

// biome-ignore lint/suspicious/noExplicitAny: deep JSON structure from external module
type Json = any;

const ABSOLUTE_REF = /^https?:\/\//;

/**
 * Strip hyper-schema noise that Ajv either ignores or cannot compile:
 * `links` (JSON hyper-schema; carries absolute `$ref`s to related routes),
 * document identity keywords (`$schema`, `$id`), and any leftover absolute
 * `$ref` (neutralised to an always-true `{}` so compilation never fails).
 */
function sanitize(node: Json): Json {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;
  if (typeof node.$ref === "string" && ABSOLUTE_REF.test(node.$ref)) return {};
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "links" || key === "$schema" || key === "$id") continue;
    out[key] = sanitize(value);
  }
  return out;
}

/** Resolve a single-level local `#/definitions/X` reference against `defs`. */
function resolveLocal(node: Json, defs: Json): Json {
  if (node && typeof node === "object" && typeof node.$ref === "string") {
    const m = /^#\/definitions\/(.+)$/.exec(node.$ref);
    const name = m?.[1];
    if (name && defs && defs[name] !== undefined) return defs[name];
  }
  return node;
}

/**
 * Transform a jsonapi_schema resource-object schema into a JSON Schema that
 * validates a dropsh create/update payload — a JSON:API document envelope
 * `{ data: { type, id, attributes, relationships } }`.
 *
 * The module emits `{ allOf: [ { properties: { type, attributes, relationships }
 * (local $refs) }, { $ref: "https://jsonapi.org/schema#/definitions/resource" } ],
 * definitions: {...} }`. We inline the local definitions, drop the external
 * jsonapi.org `$ref` (Ajv cannot fetch it), and wrap the resource object as the
 * `data` member. dropsh's `toOperationVariant` later tailors `required` per
 * operation, so we only assert the resource `type` here.
 */
export function buildWriteSchema(resourceSchema: unknown): unknown {
  const root = resourceSchema as Json;
  if (root === null || typeof root !== "object") {
    throw new Error("jsonapi_schema response is not an object");
  }
  const defs = root.definitions ?? {};
  const allOf = Array.isArray(root.allOf) ? root.allOf : [];
  const resourceMember = allOf.find(
    (m: Json) => m && typeof m === "object" && m.properties && typeof m.properties === "object",
  );
  const props: Json = resourceMember?.properties;
  if (!props || (props.attributes === undefined && props.type === undefined)) {
    throw new Error("jsonapi_schema response has no resource-object properties");
  }

  const dataProperties: Record<string, Json> = {
    type: sanitize(resolveLocal(props.type ?? { type: "string" }, defs)),
    id: { type: "string" },
  };
  if (props.attributes !== undefined) {
    dataProperties.attributes = sanitize(resolveLocal(props.attributes, defs));
  }
  if (props.relationships !== undefined) {
    dataProperties.relationships = sanitize(resolveLocal(props.relationships, defs));
  }

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: dataProperties,
        required: ["type"],
      },
    },
    required: ["data"],
  };
}
