import type { JsonApiClient } from "dropsh/plugin";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Browse } from "../../src/browse-app.js";
import { buildRegistry } from "../../src/registry.js";
import { createRouter } from "../../src/router.js";

function client(): JsonApiClient {
  return {
    get: vi.fn(async () => ({
      data: { type: "node--article", id: "u9", attributes: { title: "Fetched" } },
    })),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  } as unknown as JsonApiClient;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("Browse", () => {
  it("renders the seeded entity via the generic view", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate(
      "entity.canonical",
      { type: "node", bundle: "article", id: "u1" },
      {
        data: {
          type: "node--article",
          id: "u1",
          attributes: { title: "Alpha" },
          relationships: { uid: { data: { type: "user--user", id: "a1" } } },
        },
      },
    );
    const { lastFrame } = render(<Browse router={router} onExit={() => {}} />);
    await tick();
    expect(lastFrame()).toContain("Alpha");
    expect(lastFrame()).toContain("uid");
  });

  it("exits when back() empties the stack", async () => {
    const c = client();
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate(
      "entity.canonical",
      { type: "node", bundle: "article", id: "u1" },
      {
        data: { type: "node--article", id: "u1", attributes: { title: "Alpha" } },
      },
    );
    const onExit = vi.fn();
    const { stdin } = render(<Browse router={router} onExit={onExit} />);
    await tick();
    stdin.write("q");
    await tick();
    expect(onExit).toHaveBeenCalled();
  });

  it("surfaces a navigation error instead of crashing", async () => {
    const c = {
      get: vi.fn(async () => {
        throw new Error("boom");
      }),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
    } as unknown as JsonApiClient;
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    await router.navigate(
      "entity.canonical",
      { type: "node", bundle: "article", id: "u1" },
      {
        data: {
          type: "node--article",
          id: "u1",
          attributes: { title: "Alpha" },
          relationships: { uid: { data: { type: "user--user", id: "a1" } } },
        },
      },
    );
    const { lastFrame, stdin } = render(<Browse router={router} onExit={() => {}} />);
    await tick();
    stdin.write("\r"); // Enter → navigate to user/a1 → client.get rejects
    await tick();
    expect(lastFrame()).toContain("boom");
  });
});
