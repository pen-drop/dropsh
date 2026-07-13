export default function makeD() {
  // Count constructions so a test can prove a shared (diamond) dependency's
  // factory runs exactly once — de-duplicated, not re-initialized (AC-3).
  globalThis.__DROPSH_DIAMOND_D_CONSTRUCTIONS =
    (globalThis.__DROPSH_DIAMOND_D_CONSTRUCTIONS ?? 0) + 1;
  return { id: "d", requiredModules: [] };
}
