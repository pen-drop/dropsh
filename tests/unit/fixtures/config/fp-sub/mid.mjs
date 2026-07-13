// fp-sub/mid.mjs — its "./leaf.mjs" resolves to fp-sub/leaf.mjs (a different
// file than configDir/leaf.mjs), so the raw descriptor string collides with an
// ancestor's while the resolved module does not: no cycle.
export default function makeMid() {
  return { id: "mid", requiredModules: [], dependencies: [{ plugin: "./leaf.mjs" }] };
}
