import type { DrupalCliPlugin, PluginContext } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { fetchSchemata, SCHEMATA_MISS } from "./schemata.js";

export function schemataPlugin(): DrupalCliPlugin {
  return {
    id: "schemata",
    requiredModules: ["schemata", "jsonapi_schema"],

    async extendSchema(
      entityType: string,
      bundle: string,
      baseSchema: unknown,
      ctx: PluginContext,
    ): Promise<unknown> {
      let result: unknown | typeof SCHEMATA_MISS;
      try {
        result = await fetchSchemata({
          http: ctx.http,
          auth: ctx.auth,
          baseUrl: ctx.baseUrl,
          entity: entityType,
          bundle,
        });
      } catch (err) {
        if (err instanceof HttpError) return baseSchema;
        throw err;
      }
      if (result === SCHEMATA_MISS) return baseSchema;
      return result;
    },
  };
}
