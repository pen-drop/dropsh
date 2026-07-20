// Pure helpers for init-worktree — no side effects, unit-tested.
import { createHash } from "node:crypto";
import { basename } from "node:path";

/** DNS/DDEV-safe slug: lowercase, non-alphanumerics → single hyphen, trimmed, ≤40 chars. */
export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Derive a unique, deterministic DDEV project name for a worktree.
 * slug(branch) + 8-hex sha256(worktreeRoot); stable per worktree dir,
 * unique across worktrees even on the same branch.
 */
export function deriveProjectName(branch, worktreeRoot) {
  const raw = branch && branch !== "HEAD" ? branch : basename(worktreeRoot);
  const slug = slugify(raw);
  const hash = createHash("sha256").update(worktreeRoot).digest("hex").slice(0, 8);
  return slug ? `${slug}-${hash}` : `dropsh-${hash}`;
}

/** Replace every `__DDEV_PROJECT__` token with the derived name. */
export function renderTemplate(source, projectName) {
  return source.replaceAll("__DDEV_PROJECT__", projectName);
}
