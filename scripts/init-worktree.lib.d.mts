// Type declarations for the pure init-worktree helpers (implementation in
// init-worktree.lib.mjs). Kept alongside the plain-JS lib so the vitest unit
// test can import it under `tsc`'s type-check.

/** DNS/DDEV-safe slug: lowercase, non-alphanumerics → single hyphen, trimmed, ≤40 chars. */
export function slugify(input: string): string;

/**
 * Derive a unique, deterministic DDEV project name for a worktree:
 * slug(branch) + 8-hex sha256(worktreeRoot).
 */
export function deriveProjectName(branch: string, worktreeRoot: string): string;

/** Replace every `__DDEV_PROJECT__` token with the derived name. */
export function renderTemplate(source: string, projectName: string): string;
