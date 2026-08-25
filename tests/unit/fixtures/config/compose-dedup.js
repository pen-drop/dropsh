// Two composite (nested-array) entries sharing a child id: the shared child is
// emitted once, so a composite stays indistinguishable from N separate entries.
export default {
  site: { base_url: "https://example.com" },
  plugins: [
    [
      { id: "shared", requiredModules: [] },
      { id: "only-a", requiredModules: [] },
    ],
    [
      { id: "shared", requiredModules: [] },
      { id: "only-b", requiredModules: [] },
    ],
  ],
};
