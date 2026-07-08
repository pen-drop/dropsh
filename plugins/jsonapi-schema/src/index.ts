import type { DropSHPlugin, PluginContext } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { buildWriteSchema, fetchJsonapiSchema, JSONAPI_SCHEMA_MISS } from "./jsonapi-schema.js";

/**
 * Authoritative JSON:API write-schema source backed by the Drupal
 * `jsonapi_schema` module (works on Drupal 10.1+/11 + PHP 8.4, unlike the
 * dead `schemata_json_schema` endpoint which 500s there).
 *
 * Outcomes are distinguished instead of collapsed into one silent fallback:
 * - 200 → the derived write schema replaces the heuristic base.
 * - 404 → the module/route is absent; fall back to the heuristic base **and**
 *   warn why (so the user knows the constraint-bearing schema is missing).
 * - any other status / unparseable body → the endpoint is broken; fall back to
 *   the heuristic base **and** warn visibly. Never swallowed silently.
 */
export function jsonapiSchemaPlugin(): DropSHPlugin {
  return {
    id: "jsonapi-schema",
    requiredModules: ["jsonapi_schema"],

    async extendSchema(
      entityType: string,
      bundle: string,
      baseSchema: unknown,
      ctx: PluginContext,
    ): Promise<unknown> {
      const target = `${entityType}/${bundle}`;
      try {
        const raw = await fetchJsonapiSchema({
          http: ctx.http,
          auth: ctx.auth,
          baseUrl: ctx.baseUrl,
          jsonapiPrefix: ctx.jsonapiPrefix ?? "/jsonapi",
          entity: entityType,
          bundle,
        });
        if (raw === JSONAPI_SCHEMA_MISS) {
          ctx.warn?.(
            `warning: jsonapi_schema module not enabled (no schema route for ${target}); ` +
              `falling back to the heuristic schema (no required fields, no constraints)`,
          );
          return baseSchema;
        }
        return buildWriteSchema(raw);
      } catch (err) {
        if (err instanceof HttpError) {
          ctx.warn?.(
            `warning: jsonapi_schema endpoint for ${target} is broken (HTTP ${err.status}); ` +
              `falling back to the heuristic schema`,
          );
        } else {
          ctx.warn?.(
            `warning: jsonapi_schema endpoint for ${target} returned an unusable schema ` +
              `(${(err as Error).message}); falling back to the heuristic schema`,
          );
        }
        return baseSchema;
      }
    },
  };
}
