// Names a plugin package that is not installed: listing must still report this
// connection's base_url, because it reads `site` without constructing plugins.
export default {
  site: { base_url: "https://with-plugin.example.com" },
  plugins: [{ plugin: "@dropsh/plugin-does-not-exist" }],
};
