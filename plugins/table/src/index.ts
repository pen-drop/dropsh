import type { DropSHPlugin } from "dropsh/plugin";
import { renderTable } from "./render-table.js";

export { renderTable };

export function tablePlugin(): DropSHPlugin {
  return {
    id: "table",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [{ id: "table", render: renderTable }],
  };
}
