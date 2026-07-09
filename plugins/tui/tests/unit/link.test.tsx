import { describe, expect, it } from "vitest";

// Force chalk (used internally by ink to render styles such as `inverse`) to
// emit real ANSI escapes even though tests run outside a TTY. This must be
// set before ink — and anything that imports it — is loaded, so those
// modules are imported dynamically below, after this line runs.
process.env.FORCE_COLOR = "1";

const { Text } = await import("ink");
const { render } = await import("ink-testing-library");
const { FocusRegistryProvider, TuiLink, useFocusRegistry } = await import("../../src/link.js");

const tick = () => new Promise((r) => setTimeout(r, 30));

// Renders the registry's observable state so the test can assert registration
// count and which target is focused — after mount effects have run.
function Probe() {
  const reg = useFocusRegistry();
  return (
    <Text>
      count={reg.count()} focus={reg.targetAt(reg.focusedIndex)?.params.id ?? "none"}
    </Text>
  );
}

function tree(focusedIndex: number) {
  return (
    <FocusRegistryProvider focusedIndex={focusedIndex}>
      <TuiLink target={{ route: "entity.canonical", params: { id: "u1" } }}>Alpha</TuiLink>
      <TuiLink target={{ route: "entity.canonical", params: { id: "u2" } }}>Beta</TuiLink>
      <Probe />
    </FocusRegistryProvider>
  );
}

describe("TuiLink + FocusRegistry", () => {
  it("registers each link once, in order, and resolves the focused target", async () => {
    const { lastFrame } = render(tree(1));
    await tick();
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
    // Both links registered exactly once (no render-time duplicate registration).
    expect(lastFrame()).toContain("count=2");
    // focusedIndex 1 resolves to the second registered link (Beta / u2), proving
    // registration order is DOM order and targetAt/focusedIndex wiring works.
    expect(lastFrame()).toContain("focus=u2");
  });

  it("wraps only the focused link in inverse styling", async () => {
    const a = render(tree(0));
    await tick();
    const f0 = a.lastFrame() ?? "";
    const b = render(tree(1));
    await tick();
    const f1 = b.lastFrame() ?? "";
    const INV = "[7m"; // ANSI SGR: inverse on
    // focusedIndex 0 → only "Alpha" is highlighted.
    expect(f0).toContain(`${INV}Alpha`);
    expect(f0).not.toContain(`${INV}Beta`);
    // focusedIndex 1 → only "Beta" is highlighted.
    expect(f1).toContain(`${INV}Beta`);
    expect(f1).not.toContain(`${INV}Alpha`);
  });
});
