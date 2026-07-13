export function make() {
  return {
    id: "parent-missing",
    requiredModules: [],
    dependencies: [{ plugin: "@dropsh/definitely-not-installed" }],
  };
}
