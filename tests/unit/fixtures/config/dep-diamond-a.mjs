export default function makeA() {
  return {
    id: "a",
    requiredModules: [],
    dependencies: [{ plugin: "./dep-diamond-b.mjs" }, { plugin: "./dep-diamond-c.mjs" }],
  };
}
