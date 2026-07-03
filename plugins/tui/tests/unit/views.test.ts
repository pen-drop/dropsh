import { ConfigError } from "dropsh/plugin";
import { describe, expect, it } from "vitest";
import { assertTty, resolveView } from "../../src/views.js";

describe("resolveView", () => {
  it("matches a view by entityType and bundle", () => {
    const v = resolveView(
      {
        views: [
          { entityType: "node", bundle: "article", columns: ["title", "status"], pageSize: 10 },
        ],
      },
      "node",
      "article",
    );
    expect(v.columns).toEqual(["title", "status"]);
    expect(v.pageSize).toBe(10);
    expect(v.detailRenderer).toBe("md");
  });

  it("falls back to defaults when no view matches", () => {
    const v = resolveView({ defaultPageSize: 42 }, "node", "page");
    expect(v.columns).toBeUndefined();
    expect(v.pageSize).toBe(42);
    expect(v.detailRenderer).toBe("md");
  });

  it("prefers a bundle-specific view over an entityType-only view", () => {
    const v = resolveView(
      {
        views: [
          { entityType: "node" },
          { entityType: "node", bundle: "article", columns: ["title"] },
        ],
      },
      "node",
      "article",
    );
    expect(v.columns).toEqual(["title"]);
  });
});

describe("assertTty", () => {
  it("passes when a TTY is present", () => {
    expect(() => assertTty(true)).not.toThrow();
  });
  it("throws ConfigError without a TTY", () => {
    expect(() => assertTty(false)).toThrow(ConfigError);
  });
});
