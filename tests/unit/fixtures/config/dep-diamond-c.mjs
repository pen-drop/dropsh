export default function makeC() {
  return { id: "c", requiredModules: [], dependencies: [{ plugin: "./dep-diamond-d.mjs" }] };
}
