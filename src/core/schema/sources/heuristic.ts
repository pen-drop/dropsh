import { HttpError } from "../../../errors.js";
import type { AuthAdapter } from "../../auth/types.js";
import type { HttpClient } from "../../http.js";

export interface HeuristicDeps {
  http: HttpClient;
  auth: AuthAdapter;
  baseUrl: string;
  jsonapiPrefix: string;
  entity: string;
  bundle: string;
}

export interface HeuristicResult {
  schema: unknown;
  empty: boolean;
}

type TypeMarker = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

function inferType(v: unknown): TypeMarker {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(v) ? "integer" : "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

function mergeTypes(types: Set<TypeMarker>): unknown {
  const arr = [...types].filter((t) => t !== undefined);
  if (arr.length === 0) return {};
  // A field that is `null` in every sample carries no type information — leave
  // it permissive rather than locking it to `type: null` (which would reject any
  // real value written later).
  if (arr.length === 1) return arr[0] === "null" ? {} : { type: arr[0] };
  return { type: arr };
}

export async function fetchHeuristic(deps: HeuristicDeps): Promise<HeuristicResult> {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const prefix = deps.jsonapiPrefix.startsWith("/") ? deps.jsonapiPrefix : `/${deps.jsonapiPrefix}`;
  const url = `${base}${prefix}/${deps.entity}/${deps.bundle}?page%5Blimit%5D=3`;
  const req = await deps.auth.apply({
    method: "GET",
    url,
    headers: { Accept: "application/vnd.api+json" },
  });
  const res = await deps.http.send(req);
  if (res.status < 200 || res.status >= 300) {
    throw new HttpError(res.status, `cannot reach ${url}: HTTP ${res.status}`, res.body);
  }
  const body = JSON.parse(res.body) as {
    data?: Array<{ attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }>;
  };
  const records = body.data ?? [];

  const resourceType = `${deps.entity}--${deps.bundle}`;
  const attrTypes = new Map<string, Set<TypeMarker>>();
  const relNames = new Set<string>();

  for (const r of records) {
    for (const [k, v] of Object.entries(r.attributes ?? {})) {
      if (!attrTypes.has(k)) attrTypes.set(k, new Set());
      attrTypes.get(k)?.add(inferType(v));
    }
    for (const k of Object.keys(r.relationships ?? {})) relNames.add(k);
  }

  const attrProps: Record<string, unknown> = {};
  for (const [k, types] of attrTypes) attrProps[k] = mergeTypes(types);

  const relProps: Record<string, unknown> = {};
  for (const k of relNames) {
    relProps[k] = {
      type: "object",
      properties: {
        data: {
          oneOf: [
            {
              type: "object",
              properties: { type: { type: "string" }, id: { type: "string", format: "uuid" } },
              required: ["type", "id"],
            },
            {
              type: "array",
              items: {
                type: "object",
                properties: { type: { type: "string" }, id: { type: "string", format: "uuid" } },
                required: ["type", "id"],
              },
            },
            { type: "null" },
          ],
        },
      },
    };
  }

  const schema = {
    $schema: "https://json-schema.org/draft-07/schema",
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          type: { const: resourceType },
          id: { type: "string", format: "uuid" },
          attributes: { type: "object", properties: attrProps, required: [] as string[] },
          relationships: { type: "object", properties: relProps, required: [] as string[] },
        },
        required: ["type"],
      },
    },
    required: ["data"],
  };

  return { schema, empty: records.length === 0 };
}
