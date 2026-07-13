export default function makeA() {
  return { id: "a", requiredModules: [], dependencies: [{ plugin: "./dep-b.mjs" }] };
}
