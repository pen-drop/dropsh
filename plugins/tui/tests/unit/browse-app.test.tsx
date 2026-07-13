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

  it("ignores a second Enter while a navigation is already in flight", async () => {
    let resolveGet: () => void = () => {};
    const get = vi.fn(
      () =>
        new Promise((res) => {
          resolveGet = () =>
            res({
              data: { type: "node--article", id: "u9", attributes: { title: "Fetched" } },
            });
        }),
    );
    const c = {
      get,
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
    const { stdin } = render(<Browse router={router} onExit={() => {}} />);
    await tick();
    stdin.write("\r"); // first Enter → navigate starts, client.get pending
    await tick();
    stdin.write("\r"); // second Enter while in flight → must be ignored
    await tick();
    resolveGet();
    await tick();
    expect(get).toHaveBeenCalledTimes(1);
    expect(router.stackDepth()).toBe(2);
  });

  it("navigates using the newly-rendered entity's links, not the previous entity's (regression)", async () => {
    const rel = (id: string) => ({
      field_ref: { data: { type: "node--article", id } },
    });
    const get = vi.fn(async (path: string) => {
      // A already seeded; B links to C; C links to D.
      if (path === "node/article/B") {
        return {
          data: {
            type: "node--article",
            id: "B",
            attributes: { title: "Bee" },
            relationships: rel("C"),
          },
        };
      }
      return {
        data: { type: "node--article", id: path.split("/").pop(), attributes: { title: "X" } },
      };
    });
    const c = {
      get,
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
    } as unknown as JsonApiClient;
    const router = createRouter({ registry: buildRegistry([]), client: c, viewMode: "default" });
    // Seed A, which links to B.
    await router.navigate(
      "entity.canonical",
      { type: "node", bundle: "article", id: "A" },
      {
        data: {
          type: "node--article",
          id: "A",
          attributes: { title: "Ay" },
          relationships: rel("B"),
        },
      },
    );
    const { stdin } = render(<Browse router={router} onExit={() => {}} />);
    await tick();
    stdin.write("\r"); // Enter on A's field_ref → fetch B
    await tick();
    stdin.write("\r"); // Enter on the link now shown for B → must fetch C, NOT B again
    await tick();
    expect(get).toHaveBeenCalledWith("node/article/C");
  });
});
