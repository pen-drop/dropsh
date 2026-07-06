import type { JsonApiDocument, JsonApiResource } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { GenericEntityList } from "../../src/entity-list.js";
import { FocusRegistryProvider } from "../../src/link.js";

const link = (route: string, params: Record<string, string>) => ({ route, params });

describe("GenericEntityList", () => {
  it("renders one navigable row per resource with a title label", () => {
    const rows: JsonApiResource[] = [
      { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
      { type: "node--article", id: "u2", attributes: { title: "Beta" } },
    ];
    const doc: JsonApiDocument = { data: rows };
    const el = new GenericEntityList().build(rows, { viewMode: "default", doc, link });
    const { lastFrame } = render(<FocusRegistryProvider>{el}</FocusRegistryProvider>);
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
  });

  it("shows (no results) for an empty collection", () => {
    const doc: JsonApiDocument = { data: [] };
    const el = new GenericEntityList().build([], { viewMode: "default", doc, link });
    const { lastFrame } = render(<FocusRegistryProvider>{el}</FocusRegistryProvider>);
    expect(lastFrame()).toContain("(no results)");
  });
});
