# Display Builder Schema Plugin

**Date:** 2026-06-04
**Status:** Ready for user review
**Branch:** `feat/display-builder-plugin`
**Base:** `origin/1.x`

## Goal

Build a `plugins/display-builder` workspace package that extends `dropsh schema` for Drupal Display Builder entity-view integrations.

The plugin must make Display Builder write payloads machine-readable enough for AI-assisted create/update workflows. It does this by adding field-specific JSON Schema for the Display Builder override field configured on the target entity view display.

The first scope is schema generation only. No `dropsh discover`, mode markdowns, UI, or custom dropsh Drupal companion module are included.

## Drupal Data Source

Display Builder integration is discovered through Drupal entity view display config, for example:

```text
core.entity_view_display.node.article.default
```

The relevant Display Builder settings live in `third_party_settings.display_builder`:

- `profile`: the Display Builder profile used by the default display.
- `override_field`: the content field used to store per-entity Display Builder overrides.
- `override_profile`: the Display Builder profile used for content overrides, when configured.

The plugin must not guess fields by shape alone. It should ask Display Builder for the effective metadata for an entity type, bundle, and view mode, then extend only the configured override field.

## Required Display Builder Metadata API

dropsh may depend on an existing or patched Display Builder endpoint. A small Display Builder patch is acceptable if the current module does not expose the needed data.

The required endpoint is read-only and should be equivalent to:

```text
GET /api/display-builder/schema/entity-view/{entity_type}/{bundle}/{view_mode}
```

The exact path may change during implementation if Display Builder has an established API convention, but the response must expose:

- whether Display Builder is enabled for the entity view display
- target entity type, bundle, and view mode
- Display Builder profile ID and label
- override field name, when content overrides are enabled
- override profile ID, when configured
- Display Builder instance ID, when available
- current source tree or present state
- allowed components for this display/profile
- allowed UI Patterns source plugins
- source configuration schema or structured source configuration metadata
- unsupported source plugins, if any

`@dropsh/sdc-client` remains the source for general SDC component definitions from `jsonapi_sdc`. Display Builder metadata supplies the field-specific restrictions and source rules.

If the endpoint is missing for an active Display Builder integration, dropsh must fail with a clear diagnostic that points to the required Display Builder metadata API or patch.

## dropsh Plugin Architecture

Create a package:

```text
plugins/display-builder
```

Public factory:

```ts
displayBuilderPlugin()
```

The plugin implements `extendOperationSchema(entityType, bundle, operation, schema, ctx)`.

Runtime flow:

1. Fetch Display Builder metadata for `{ entityType, bundle, viewMode: "default" }`.
2. If metadata says Display Builder is not enabled, return the schema unchanged.
3. If metadata says Display Builder is enabled but no writable override field is configured, return the schema unchanged and add no partial builder schema.
4. Fetch SDC components through `@dropsh/sdc-client`.
5. Intersect SDC component definitions with the components allowed by Display Builder metadata.
6. Extend `data.attributes.<override_field>` with a Display Builder source-tree schema.
7. Add `x-dropsh-*` metadata describing the Display Builder integration, components, and sources.

This keeps core dropsh entity-agnostic and follows the existing Canvas plugin pattern.

## JSON Schema Contract

For an active Display Builder entity view display, the generated schema must describe the configured override field as a Display Builder source tree.

The schema should use standard JSON Schema constructs where they are useful:

- `type`
- `properties`
- `required`
- `additionalProperties`
- `enum`
- `const`
- `oneOf`
- `description`

Each source-node variant must be selected by `source_id`. Component sources must restrict `component_id` to the components allowed by Display Builder for this field/profile. Source configuration must be generated from the source metadata returned by Display Builder or UI Patterns.

Conceptual source-node shape:

```json
{
  "source_id": "component",
  "source": {
    "component": {
      "component_id": "provider:component",
      "props": {},
      "slots": {}
    }
  }
}
```

The final implementation must verify the exact writable payload shape against Display Builder's current JSON:API/storage behavior. The design requirement is field-specific correctness, not this illustrative object shape.

Nested slots should be represented recursively enough for practical authoring. If unbounded recursion is not viable in the JSON Schema dialect already used by dropsh, the schema may use a bounded nesting depth and document that depth in `description` and `x-dropsh-display-builder`.

Required extension metadata:

```json
{
  "x-dropsh-builder": "display-builder",
  "x-dropsh-display-builder": {
    "entity_type": "node",
    "bundle": "article",
    "view_mode": "default",
    "profile": "default",
    "override_field": "field_display_builder_override"
  },
  "x-dropsh-components": [],
  "x-dropsh-sources": []
}
```

Unsupported source plugins must not be emitted as free-form valid payload. They should either be excluded from the validating schema and listed in metadata, or represented with an explicit unsupported marker that cannot accidentally validate as writable content.

## Error Handling

The plugin must avoid partial schemas that imply unsupported Display Builder writes are safe.

Expected behavior:

- Display Builder not installed or not enabled for the target bundle: return schema unchanged.
- Display Builder metadata endpoint returns 404 for an active integration: throw a clear error explaining that the Display Builder metadata API or patch is required.
- `jsonapi_sdc` missing, inaccessible, malformed, or empty when Display Builder is active: throw a clear error, matching the Canvas plugin style.
- Active Display Builder metadata lacks source schema data: throw a clear error rather than guessing source payloads.
- Active Display Builder metadata references components unknown to `jsonapi_sdc`: throw a clear consistency error.
- Unknown source plugins: exclude from the valid schema and list them under metadata.

## Testing

Unit tests for the metadata client:

- builds the metadata endpoint URL for entity type, bundle, and default view mode
- normalizes inactive Display Builder responses
- normalizes active Display Builder responses with profile, override field, components, sources, and current source tree
- throws clear errors for invalid JSON, malformed metadata, and missing required source schema data

Unit tests for the schema extender:

- inactive metadata leaves the base schema unchanged
- active metadata extends only `data.attributes.<override_field>`
- allowed components become `const` or `enum` restrictions
- allowed source plugins become `oneOf` variants
- unsupported sources are excluded from validation and listed in metadata
- base schema and component metadata are deep-cloned before modification
- generated schema compiles with Ajv

Plugin tests:

- `displayBuilderPlugin()` calls the Display Builder metadata client before SDC when possible
- inactive targets do not fetch SDC components
- active targets fetch SDC components and extend the operation schema
- missing `jsonapi_sdc` produces a clear Display Builder-specific diagnostic
- missing metadata endpoint for active Display Builder produces a patch/API diagnostic

Integration tests:

- DDEV `db` fixture enables `display_builder`, `display_builder_entity_view`, `ui_patterns`, `ui_patterns_library`, and `jsonapi_sdc`
- fixture config enables Display Builder on `core.entity_view_display.node.article.default`
- fixture config defines an override field and profile
- `playground/db/dropsh.config.js` registers `displayBuilderPlugin()`
- `dropsh schema node/article --for=create --config playground/db/dropsh.config.js` contains `x-dropsh-builder: "display-builder"`
- the generated schema contains the configured override field and field-specific components/sources

End-to-end create/update with real Display Builder override payloads is desirable, but may be deferred until the exact writable JSON:API payload shape is verified.

## Non-Goals

- No `dropsh discover` work.
- No mode markdowns.
- No visual editor integration.
- No custom dropsh Drupal companion module.
- No client-side reconstruction of Display Builder admin forms.
- No free-form fallback schema for unknown source plugins.
- No Layout Builder work.

## Open Implementation Checks

The implementation plan must verify:

- the exact current Display Builder entity-view metadata available from PHP services
- the smallest acceptable Display Builder patch for exposing that metadata read-only
- the exact stored/writable shape of the override field in JSON:API
- whether the default view mode is sufficient for the first release or whether plugin options should later support another view mode
- the practical recursion depth for source-tree JSON Schema
