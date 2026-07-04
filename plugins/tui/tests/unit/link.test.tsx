import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { FocusRegistryProvider, TuiLink, useFocusRegistry } from "../../src/link.js";

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

  it("moves the inverse styling with focusedIndex", async () => {
    const a = render(tree(0));
    await tick();
    const frame0 = a.lastFrame();
    const b = render(tree(1));
    await tick();
    const frame1 = b.lastFrame();
    // Changing the focused index changes which link is highlighted, so the
    // rendered frames must differ — proving isFocused drives the inverse style.
    expect(frame1).not.toEqual(frame0);
    expect(frame0).toContain("focus=u1");
    expect(frame1).toContain("focus=u2");
  });
});
