import { fetchSdcComponents } from "@dropsh/sdc-client";
import type { DropSHPlugin } from "dropsh/plugin";
import { HttpError } from "dropsh/plugin";
import { fetchDisplayBuilderMetadata } from "./metadata-client.js";
import { extendDisplayBuilderSchema } from "./schema.js";

export function displayBuilderPlugin(): DropSHPlugin {
  return {
    id: "display-builder",
    requiredModules: ["display_builder", "display_builder_entity_view", "jsonapi_sdc"],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    async extendOperationSchema(entityType, bundle, _operation, schema, ctx) {
      const metadata = await fetchDisplayBuilderMetadata(ctx, entityType, bundle, "default");
      if (!metadata.enabled || !metadata.overrideField) {
        return schema;
      }

      let components: Awaited<ReturnType<typeof fetchSdcComponents>>;
      try {
        components = await fetchSdcComponents(ctx);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          throw new HttpError(
            404,
            "Display Builder plugin requires Drupal module jsonapi_sdc to build component schemas.",
            err.body,
          );
        }
        throw err;
      }

      return extendDisplayBuilderSchema(schema, metadata, components);
    },
  };
}
