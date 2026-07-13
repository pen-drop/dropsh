// configDir/leaf.mjs — declares a dependency using the SAME relative string
// ("./leaf.mjs") that fp-sub/mid.mjs also uses, but here it resolves to a
// different file (fp-sub/mid.mjs's "./leaf.mjs" is fp-sub/leaf.mjs).
export default function makeLeafRoot() {
  return { id: "leaf-root", requiredModules: [], dependencies: [{ plugin: "./fp-sub/mid.mjs" }] };
}
