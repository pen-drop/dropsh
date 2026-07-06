import type { DropSHPlugin } from "dropsh/plugin";
import { renderMarkdown } from "./render-md.js";

export { renderMarkdown };

export function markdownPlugin(): DropSHPlugin {
  return {
    id: "markdown",
    requiredModules: [],
    async extendSchema(_entityType, _bundle, schema) {
      return schema;
    },
    renderers: [{ id: "md", render: renderMarkdown }],
  };
}
