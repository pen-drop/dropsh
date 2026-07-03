import type { JsonApiClient } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Browse } from "../../src/browse-app.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({
      data: [
        { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
        { type: "node--article", id: "u2", attributes: { title: "Beta" } },
      ],
    })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

function fakeClientWithColumns(): JsonApiClient {
  return {
    get: vi.fn(async () => ({
      data: [
        { type: "node--article", id: "u1", attributes: { title: "Alpha", status: "published" } },
        { type: "node--article", id: "u2", attributes: { title: "Beta", status: "draft" } },
      ],
    })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("Browse", () => {
  it("renders the fetched list rows", async () => {
    const { lastFrame } = render(
      <Browse
        client={fakeClient()}
        entityType="node"
        bundle="article"
        view={{ filters: {}, detailRenderer: "md", pageSize: 25 }}
      />,
    );
    await tick();
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("Beta");
  });

  it("renders configured columns instead of the title heuristic", async () => {
    const { lastFrame } = render(
      <Browse
        client={fakeClientWithColumns()}
        entityType="node"
        bundle="article"
        view={{ columns: ["id", "status"], filters: {}, detailRenderer: "md", pageSize: 25 }}
      />,
    );
    await tick();
    const frame = lastFrame();
    expect(frame).toContain("u1");
    expect(frame).toContain("published");
    expect(frame).toContain("u2");
    expect(frame).toContain("draft");
    expect(frame).not.toContain("Alpha");
    expect(frame).not.toContain("Beta");
  });
});
