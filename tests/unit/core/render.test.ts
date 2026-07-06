import { describe, expect, it } from "vitest";
import { indexIncluded, isInteractive } from "../../../src/core/cli/render.js";
import type { AnyRenderer } from "../../../src/core/cli/render.js";

describe("indexIncluded", () => {
  it("indexes included resources by type/id", () => {
    const map = indexIncluded({
      data: { type: "node--article", id: "u1" },
      included: [
        { type: "node--article", id: "r1", attributes: { title: "Related" } },
        { type: "user--user", id: "a1" },
      ],
    });
    expect(map.size).toBe(2);
    expect(map.get("node--article/r1")?.attributes?.title).toBe("Related");
    expect(map.get("user--user/a1")?.id).toBe("a1");
  });

  it("returns an empty map when there is no included", () => {
    expect(indexIncluded({ data: { type: "node--article", id: "u1" } }).size).toBe(0);
  });
});

describe("isInteractive", () => {
  it("returns true for a renderer with interactive: true", () => {
    const r: AnyRenderer = { id: "tui", interactive: true, run: async () => {} };
    expect(isInteractive(r)).toBe(true);
  });

  it("returns false for a plain string renderer", () => {
    const r: AnyRenderer = { id: "md", render: () => "" };
    expect(isInteractive(r)).toBe(false);
  });
});
