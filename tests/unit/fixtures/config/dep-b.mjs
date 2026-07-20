export default function makeB() {
  return { id: "b", requiredModules: [], dependencies: [{ plugin: "./dep-a.mjs" }] };
}
