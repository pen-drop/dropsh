import type { JsonApiDocument, JsonApiResource } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { GenericEntityView } from "../../src/entity-view.js";
import { FocusRegistryProvider } from "../../src/link.js";

const link = (route: string, params: Record<string, string>) => ({ route, params });

function ctx(doc: JsonApiDocument) {
  return { viewMode: "default", doc, link };
}

describe("GenericEntityView", () => {
  it("renders attributes and a navigable relationship", () => {
    const entity: JsonApiResource = {
      type: "node--article",
      id: "u1",
      attributes: { title: "Alpha" },
      relationships: { uid: { data: { type: "user--user", id: "a1" } } },
    };
    const doc: JsonApiDocument = { data: entity };
    const el = new GenericEntityView().build(entity, ctx(doc));
    const { lastFrame } = render(<FocusRegistryProvider>{el}</FocusRegistryProvider>);
    expect(lastFrame()).toContain("title");
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("uid");
  });
});
