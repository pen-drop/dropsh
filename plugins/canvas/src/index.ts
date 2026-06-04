import { fetchSdcComponents } from "@dropsh/sdc-client";
import type { DropSHPlugin } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { extendCanvasSchema } from "./canvas-schema.js";

export function canvasPlugin(): DropSHPlugin {
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

      let components: Awaited<ReturnType<typeof fetchSdcComponents>>;
      try {
        components = await fetchSdcComponents(ctx);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          throw new HttpError(
            404,
            "Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.",
            err.body,
          );
        }
        throw err;
      }
      return extendCanvasSchema(schema, operation, components);
    },
  };
}
