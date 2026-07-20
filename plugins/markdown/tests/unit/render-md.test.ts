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

  it("renders the raw value of a long-text field, not the processed HTML", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "gaia_ticket--gaia_ticket",
          id: "t1",
          attributes: {
            description: {
              value: "# Briefing\nThe **raw** markdown source.",
              format: "gaia_rich",
              processed: "<h1>Briefing</h1>\n<p>The <strong>raw</strong> markdown source.</p>",
            },
          },
        },
      },
      ctx,
    );
    expect(out).toContain("# Briefing");
    expect(out).toContain("The **raw** markdown source.");
    expect(out).not.toContain("<h1>");
    expect(out).not.toContain("<p>");
  });

  it("emits multi-line text as an indented block, not a \\n-escaped one-liner", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "gaia_comment--gaia_comment",
          id: "c1",
          attributes: {
            body: {
              value: "line one\n\nline three",
              format: "gaia_rich",
              processed: "<p>line one</p>\n<p>line three</p>",
            },
          },
        },
      },
      ctx,
    );
    expect(out).toContain("body: |");
    expect(out).toContain("\n  line one\n\n  line three");
    expect(out).not.toContain("\\n");
  });

  it("falls back to processed when a text object carries no raw value", () => {
    const out = renderMarkdown(
      {
        data: {
          type: "node--page",
          id: "p1",
          attributes: { body: { processed: "<p>Only processed.</p>" } },
        },
      },
      ctx,
    );
    expect(out).toContain("body: <p>Only processed.</p>");
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
