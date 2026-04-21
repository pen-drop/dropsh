# drupal-cli — Project Conventions

## Language

**All project artifacts are written in English.** This includes:

- Source code, identifiers, comments
- CLI command names, flags, help text, error messages, JSON output
- Skill content (main skill file and all mode-`*.md` files)
- Documentation under `docs/`
- Commit messages

Conversations with the human operator may be held in any language, but
everything that ends up committed to this repository must be English.

## Architecture (brief)

- **CLI** (Node.js + TypeScript): entity-agnostic helper for Drupal 11
  JSON:API. Knows nothing about modes, field names, or markdown.
- **Skill** (Claude, markdown): orchestrates the editor workflow, reads
  the input markdown, decides the target mode, loads the matching
  mode-markdown, and drives the CLI.
- **Mode markdowns** (`modes/*.md`): per-target playbooks that tell
  Claude how to map editorial content onto a JSON:API payload.

See `docs/superpowers/specs/` for the full design.
