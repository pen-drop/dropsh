import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/render-md.js";

const ctx = { command: "read" as const };

describe("renderMarkdown", () => {
  it("appends an Included section for --include'd resources", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "node--article",
          id: "u1",
          attributes: { title: "Primary" },
          relationships: { field_related: { data: { type: "node--article", id: "r1" } } },
        },
        included: [{ type: "node--article", id: "r1", attributes: { title: "Related One" } }],
      },
      ctx,
    );
    expect(out).toContain("title: Primary");
    expect(out).toContain("## Included");
    expect(out).toContain("id: r1");
    expect(out).toContain("title: Related One");
    // primary comes before the included section
    expect(out.indexOf("title: Primary")).toBeLessThan(out.indexOf("## Included"));
  });

  it("omits the Included section when there is no included", () => {
    const out = renderMarkdown(
      { data: { type: "node--article", id: "u1", attributes: { title: "Solo" } } },
      ctx,
    );
    expect(out).not.toContain("## Included");
  });

  it("renders every field as label: value", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "node--article",
          id: "u1",
          attributes: { title: "Hello", status: true, body: { value: "The text." } },
        },
      },
      ctx,
    );
    expect(out).toContain("type: node--article");
    expect(out).toContain("id: u1");
    expect(out).toContain("title: Hello");
    expect(out).toContain("status: true");
    // text-field objects collapse to their text, still as label: value
    expect(out).toContain("body: The text.");
    // no frontmatter fence
    expect(out.startsWith("---")).toBe(false);
  });

  it("does not duplicate any field when there is no body field", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "node--page",
          id: "p1",
          attributes: { title: "T", summary: "short", teaser: "a much longer piece of text here" },
        },
      },
      ctx,
    );
    expect(out).toContain("title: T");
    expect(out).toContain("summary: short");
    expect(out).toContain("teaser: a much longer piece of text here");
    // each field appears exactly once (no body-fallback duplication)
    expect(out.match(/teaser: /g)).toHaveLength(1);
  });

  it("lists relationships as type/id arrays", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "node--article",
          id: "u1",
          attributes: {},
          relationships: { uid: { data: { type: "user--user", id: "a1" } } },
        },
      },
      ctx,
    );
    expect(out).toContain("uid: [user--user/a1]");
  });

  it("joins a collection with a separator", () => {
    const out = renderMarkdown(
      {
        data: [
          { type: "node--article", id: "u1", attributes: { title: "A" } },
          { type: "node--article", id: "u2", attributes: { title: "B" } },
        ],
      },
      { command: "search" },
    );
    expect(out).toContain("id: u1");
    expect(out).toContain("id: u2");
    expect(out).toContain("\n\n---\n\n");
  });

  it("renders an empty collection as a placeholder", () => {
    expect(renderMarkdown({ data: [] }, { command: "search" })).toBe("_(no results)_");
  });
});
