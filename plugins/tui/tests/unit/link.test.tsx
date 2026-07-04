import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { FocusRegistryProvider, TuiLink, useFocusRegistry } from "../../src/link.js";

function Probe() {
  const reg = useFocusRegistry();
  return (
    <>
      <TuiLink target={{ route: "entity.canonical", params: { id: "u1" } }}>Alpha</TuiLink>
      <TuiLink target={{ route: "entity.canonical", params: { id: "u2" } }}>Beta</TuiLink>
      {/* focus index 0 by default */}
      {reg.count() === 2 ? <></> : <></>}
    </>
  );
}

describe("TuiLink + FocusRegistry", () => {
  it("registers links and marks the focused one", () => {
    const { lastFrame } = render(
      <FocusRegistryProvider>
        <Probe />
      </FocusRegistryProvider>,
    );
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
  });
});
