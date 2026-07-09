// A named plugin that cannot be resolved anywhere → loadConfig must reject.
export default {
  site: { base_url: "https://example.com" },
  plugins: [{ plugin: "@dropsh/definitely-not-installed-plugin" }],
};
