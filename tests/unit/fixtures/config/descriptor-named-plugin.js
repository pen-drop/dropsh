// Named-plugin descriptor (ESLint style): the config names the package as a
// string; dropsh resolves it (here relative to this config file) and calls the
// named export with `with`. The config itself imports nothing.
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "./fake-plugin.mjs", export: "makePlugin", with: { id: "from-name" } }],
};
