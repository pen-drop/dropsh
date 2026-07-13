// A nested array as a single `plugins[]` entry is flattened: the array groups N
// children (mix of descriptors + pre-constructed) that dropsh registers as
// separate plugin entries, and a child's own `dependencies` still expand first.
export default {
  site: { base_url: "https://example.com" },
  plugins: [
    [{ plugin: "./dep-parent.mjs", export: "makeParent" }, { id: "inline", requiredModules: [] }],
  ],
};
