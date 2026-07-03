import type { DrupalCliPlugin } from "dropsh/plugin";
import { renderTable } from "./render-table.js";

export { renderTable };

export function tablePlugin(): DrupalCliPlugin {
  return {
    id: "table",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [{ id: "table", render: renderTable }],
  };
}
