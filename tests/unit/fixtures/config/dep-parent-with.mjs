export function makeParent() {
  return {
    id: "parent-with",
    requiredModules: [],
    dependencies: [
      { plugin: "./dep-child.mjs", export: "makeChild", with: { id: "child-configured" } },
    ],
  };
}
export default makeParent;
