# Article Publishing Skill

Use this skill when the user wants to create or update standard Drupal article
content through dropsh.

This skill is intentionally thin. It chooses the right workflow and delegates
the detailed steps to files in `workflows/`.

## Requirements

- Drupal JSON:API is enabled.
- The configured dropsh auth provider can read, create, and update article
  nodes.
- Optional but recommended: `@dropsh/plugin-schemata`, so `dropsh schema` can
  use Drupal's authoritative field constraints.

## Dispatch

- Create a new article: load `workflows/create-article.md`.
- Update an existing article: load `workflows/update-article.md`.
- If the user intent is unclear, inspect existing content with `dropsh search`
  before choosing a workflow.

## Guardrails

- Always inspect the current schema before building a payload.
- Search for existing content before creating a likely duplicate.
- Use `--dry-run` before sending high-impact changes.
- Do not invent field machine names. Read them from `dropsh schema` or existing
  records.

