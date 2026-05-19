import type { DrupalCliPlugin } from "dropsh/plugin";
import { fetchSdcComponents } from "@dropsh/sdc-client";
import { extendCanvasSchema } from "./canvas-schema.js";

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
