import type { JsonApiDocument, RenderContext } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { Browse } from "../../src/browse-app.js";

const readCtx: RenderContext = { command: "read" };

function collectionDoc(): JsonApiDocument {
  return {
    data: [
      { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
      { type: "node--article", id: "u2", attributes: { title: "Beta" } },
    ],
  };
}

function collectionDocWithColumns(): JsonApiDocument {
  return {
    data: [
      { type: "node--article", id: "u1", attributes: { title: "Alpha", status: "published" } },
      { type: "node--article", id: "u2", attributes: { title: "Beta", status: "draft" } },
    ],
  };
}

function singleDoc(): JsonApiDocument {
  return {
    data: { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("Browse", () => {
  it("boots straight into the detail pane for a single-resource doc", () => {
    const { lastFrame } = render(
      <Browse
        doc={singleDoc()}
        ctx={readCtx}
        view={{ filters: {}, detailRenderer: "md", pageSize: 25 }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("type: node--article");
    expect(frame).toContain("title: Alpha");
    expect(frame).toContain("(esc/q: quit)");
  });

  it("lists rows for a collection doc", () => {
    const { lastFrame } = render(
      <Browse
        doc={collectionDoc()}
        ctx={readCtx}
        view={{ filters: {}, detailRenderer: "md", pageSize: 25 }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Alpha");
    expect(frame).toContain("Beta");
  });

  it("renders configured columns instead of the title heuristic", () => {
    const { lastFrame } = render(
      <Browse
        doc={collectionDocWithColumns()}
        ctx={readCtx}
        view={{ columns: ["id", "status"], filters: {}, detailRenderer: "md", pageSize: 25 }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("u1");
    expect(frame).toContain("published");
    expect(frame).toContain("u2");
    expect(frame).toContain("draft");
    expect(frame).not.toContain("Alpha");
    expect(frame).not.toContain("Beta");
  });

  it("opens the detail pane for the selected row on Enter", async () => {
    const { lastFrame, stdin } = render(
      <Browse
        doc={collectionDoc()}
        ctx={readCtx}
        view={{ filters: {}, detailRenderer: "md", pageSize: 25 }}
      />,
    );
    // Let the mount effect that enables raw mode (and attaches the input
    // listener) commit before writing to stdin.
    await tick();
    stdin.write("\r");
    await tick();
    const frame = lastFrame();
    expect(frame).toContain("type: node--article");
    expect(frame).toContain("title: Alpha");
    expect(frame).toContain("(esc/q: back)");
  });
});
