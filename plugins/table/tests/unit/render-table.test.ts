import { describe, expect, it } from "vitest";
import { pickColumns, renderTable } from "../../src/render-table.js";

const ctx = { command: "search" as const };

describe("pickColumns", () => {
  it("puts id first and prefers title/status", () => {
    const cols = pickColumns({
      type: "node--article",
      id: "u1",
      attributes: { body: "x", status: true, title: "T" },
    });
    expect(cols[0]).toBe("id");
    expect(cols).toContain("title");
    expect(cols).toContain("status");
  });
});

describe("renderTable", () => {
  it("renders a collection as an aligned box table", () => {
    const out = renderTable(
      {
        data: [
          { type: "node--article", id: "u1", attributes: { title: "Alpha", status: true } },
          { type: "node--article", id: "u2", attributes: { title: "Beta", status: false } },
        ],
      },
      ctx,
    );
    const lines = out.split("\n");
    // biome-ignore lint/style/noNonNullAssertion: split() on a non-empty string always yields at least one element
    expect(lines[0]!.startsWith("┌")).toBe(true);
    expect(out).toContain("u1");
    expect(out).toContain("Alpha");
    // every rendered line is the same visual width
    expect(new Set(lines.map((l) => [...l].length)).size).toBe(1);
  });

  it("renders an empty collection as (0 rows)", () => {
    expect(renderTable({ data: [] }, ctx)).toBe("(0 rows)");
  });

  it("renders a single resource as a key/value table", () => {
    const out = renderTable(
      { data: { type: "node--article", id: "u1", attributes: { title: "Solo" } } },
      { command: "read" },
    );
    expect(out).toContain("field");
    expect(out).toContain("value");
    expect(out).toContain("title");
    expect(out).toContain("Solo");
  });
});
