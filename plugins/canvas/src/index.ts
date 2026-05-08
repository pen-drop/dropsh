import type { DrupalCliPlugin } from "dropsh/plugin";
import { extendCanvasSchema } from "./canvas-schema.js";
import { fetchSdcComponents } from "./sdc-client.js";

export function canvasPlugin(): DrupalCliPlugin {
  return {
    id: "canvas",
    requiredModules: ["canvas", "jsonapi_sdc"],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    async extendOperationSchema(entityType, bundle, operation, schema, ctx) {
      if (entityType !== "canvas_page" || bundle !== "canvas_page") {
        return schema;
      }

      const components = await fetchSdcComponents(ctx);
      return extendCanvasSchema(schema, operation, components);
    },
  };
}
