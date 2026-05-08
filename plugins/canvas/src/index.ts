import type { DrupalCliPlugin } from "dropsh/plugin";

export function canvasPlugin(): DrupalCliPlugin {
  return {
    id: "canvas",
    requiredModules: ["canvas", "jsonapi_sdc"],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    async extendOperationSchema(_entityType, _bundle, _operation, schema) {
      return schema;
    },
  };
}
