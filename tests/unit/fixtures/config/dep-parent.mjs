export function makeParent(opts = {}) {
  return {
    id: opts.id ?? "parent",
    requiredModules: [],
    dependencies: [{ plugin: "./dep-child.mjs", export: "makeChild" }],
  };
}
export default makeParent;
