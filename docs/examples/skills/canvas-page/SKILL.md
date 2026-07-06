# Canvas Page Skill

Use this skill when the user wants to create or update Drupal Canvas pages with
dropsh.

`SKILL.md` only routes the request. Canvas component handling lives in workflow
files because it depends on the current site schema and component catalog.

## Requirements

- Drupal JSON:API is enabled.
- Drupal modules `canvas` and `jsonapi_sdc` are enabled.
- dropsh config registers `canvasPlugin()`.
- The authenticated user can create, edit, and read Canvas pages.

## Dispatch

- Create a new Canvas page: load `workflows/create-canvas-page.md`.
- Update an existing Canvas page: load `workflows/update-canvas-page.md`.

## Guardrails

- Always refresh the Canvas schema before building component payloads.
- Require `x-dropsh-builder: "canvas"` in the schema before using this skill.
- Read component IDs, slots, props, variants, and versions from the schema.
- Do not guess `component_id`, `component_version`, `slot`, or input shapes.

