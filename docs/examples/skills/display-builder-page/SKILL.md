# Display Builder Page Skill

Use this skill when the user wants to create or update a Drupal entity whose
rendering is controlled by Display Builder and dropsh.

This skill routes requests to workflow files. The workflows must read Display
Builder metadata from the schema before constructing source-tree payloads.

## Requirements

- Drupal JSON:API is enabled.
- Drupal modules `display_builder`, `display_builder_entity_view`, and
  `jsonapi_sdc` are enabled.
- dropsh config registers `displayBuilderPlugin()`.
- The authenticated user can read and edit the target entity and use the active
  Display Builder profile.

## Dispatch

- Create a new Display Builder page: load
  `workflows/create-display-builder-page.md`.
- Update an existing Display Builder page: load
  `workflows/update-display-builder-page.md`.

## Guardrails

- Always refresh the operation schema before building payloads.
- Require `x-dropsh-builder: "display-builder"` before using this skill.
- Read `override_field` from `x-dropsh-display-builder`; never guess it.
- Respect the profile's `component_library` restrictions.

