import { fetchSdcComponents } from "@dropsh/sdc-client";
import type { DropSHPlugin } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { extendCanvasSchema } from "./canvas-schema.js";
import { fetchComponentVersions } from "./component-versions.js";

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
      let versions: Awaited<ReturnType<typeof fetchComponentVersions>>;
      try {
        [components, versions] = await Promise.all([
          fetchSdcComponents(ctx),
          fetchComponentVersions(ctx),
        ]);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          throw new HttpError(
            404,
            "Canvas plugin requires Drupal modules canvas and jsonapi_sdc to build component schemas.",
            err.body,
          );
        }
        throw err;
      }
      return extendCanvasSchema(schema, operation, components, versions);
    },
  };
}
