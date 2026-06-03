# dropsh — Project Conventions

## Language

**All project artifacts are written in English.** This includes:

- Source code, identifiers, comments
- CLI command names, flags, help text, error messages, JSON output
- Skill content (main skill file and all mode-`*.md` files)
- Documentation under `docs/`
- Commit messages

Conversations with the human operator may be held in any language, but
everything that ends up committed to this repository must be English.

## Before committing

Run these commands and fix all failures before every commit:

```bash
pnpm run lint        # Biome lint + format check
pnpm run typecheck   # TypeScript type-check (no emit)
pnpm test            # unit tests (vitest, Node 20+)
```

To auto-fix lint and formatting issues: `pnpm run lint:fix`

The CI pipeline (`validate` stage) runs all three checks: `lint` (Node 20 only), `typecheck` and `test` (Node 20 + 22). A commit that breaks any of them will fail the pipeline.

Integration tests (`pnpm run test:integration`) require a live DDEV instance and are **not** run in CI. Run them locally when touching schema, auth, or HTTP logic:

```bash
pnpm run drupal:up          # provision DDEV + Drupal (once)
pnpm run test:integration   # requires running DDEV
pnpm run drupal:down        # tear down when done
```

## Architecture (brief)

- **CLI** (Node.js + TypeScript): entity-agnostic helper for Drupal 11
  JSON:API. Knows nothing about modes, field names, or markdown.
- **Skill** (Claude, markdown): orchestrates the editor workflow, reads
  the input markdown, decides the target mode, loads the matching
  mode-markdown, and drives the CLI.
- **Mode markdowns** (`modes/*.md`): per-target playbooks that tell
  Claude how to map editorial content onto a JSON:API payload.

See `docs/superpowers/specs/` for the full design.
