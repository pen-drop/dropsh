// Two top-level entries for the same package+export but different `with`: both
// must load — they are distinct plugin instances, not a duplicate.
export default {
  site: { base_url: "https://example.com" },
  plugins: [
    { plugin: "./dep-child.mjs", export: "makeChild", with: { id: "child-one" } },
    { plugin: "./dep-child.mjs", export: "makeChild", with: { id: "child-two" } },
  ],
};
