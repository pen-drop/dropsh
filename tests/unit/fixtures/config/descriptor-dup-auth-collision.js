// Two entries sharing the SAME auth profile id ("pm") but differing in another
// option (scope), so their descriptor identities differ and both are actually
// constructed and emitted. Both must reach the auth registry so its
// "duplicate auth profile id" guard fires (DROPSH-12 AC-3). Byte-identical
// entries would be collapsed earlier by the descriptor-identity cache and are
// out of scope for this guard.
export default {
  site: { base_url: "https://example.com" },
  plugins: [
    { plugin: "./auth-const-id.mjs", export: "makeAuth", with: { id: "pm", scope: "a" } },
    { plugin: "./auth-const-id.mjs", export: "makeAuth", with: { id: "pm", scope: "b" } },
  ],
};
