import { describe, expect, it } from "vitest";
import {
  deriveProjectName,
  renderTemplate,
  slugify,
} from "../../../scripts/init-worktree.lib.mjs";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugify("feat/DROPSH-5_init")).toBe("feat-dropsh-5-init");
  });
  it("trims leading/trailing separators", () => {
    expect(slugify("--a//b--")).toBe("a-b");
  });
  it("truncates to 40 chars with no trailing hyphen", () => {
    const s = slugify("a".repeat(50));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("deriveProjectName", () => {
  it("combines slug + 8-hex hash of the worktree path", () => {
    expect(deriveProjectName("feat/x", "/home/cw/wt")).toMatch(/^feat-x-[0-9a-f]{8}$/);
  });
  it("is stable for the same worktree path", () => {
    expect(deriveProjectName("b", "/p")).toBe(deriveProjectName("b", "/p"));
  });
  it("differs across worktree paths on the same branch", () => {
    expect(deriveProjectName("b", "/p1")).not.toBe(deriveProjectName("b", "/p2"));
  });
  it("falls back to the worktree basename when detached (HEAD)", () => {
    expect(deriveProjectName("HEAD", "/home/cw/my-tree")).toMatch(/^my-tree-[0-9a-f]{8}$/);
  });
  it("falls back to a dropsh- prefix when the slug empties", () => {
    expect(deriveProjectName("///", "/p")).toMatch(/^dropsh-[0-9a-f]{8}$/);
  });
});

describe("renderTemplate", () => {
  it("replaces every token occurrence", () => {
    expect(renderTemplate("a __DDEV_PROJECT__ b __DDEV_PROJECT__", "x")).toBe("a x b x");
  });
  it("passes through when no token is present", () => {
    expect(renderTemplate("nothing", "x")).toBe("nothing");
  });
});
