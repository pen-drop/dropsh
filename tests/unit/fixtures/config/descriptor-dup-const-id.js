// Two entries of the same package+export that carry the SAME constant plugin.id
// but distinct options (distinct auth profile ids). Both must survive plugin
// resolution — the descriptor identity (resolved path + export + options), not
// plugin.id, decides descriptor de-duplication (DROPSH-12).
export default {
  site: { base_url: "https://example.com" },
  plugins: [
    { plugin: "./auth-const-id.mjs", export: "makeAuth", with: { id: "session", default: true } },
    { plugin: "./auth-const-id.mjs", export: "makeAuth", with: { id: "pm" } },
  ],
};
