export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./dep-parent-with.mjs", export: "makeParent" }],
};
