// A single descriptor entry whose factory returns an array of plugins is
// flattened into separate entries.
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./dep-group.mjs", export: "makeGroup" }],
};
