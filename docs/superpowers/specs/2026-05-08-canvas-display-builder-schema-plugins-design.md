# Canvas and Display Builder Schema Plugins

**Date:** 2026-05-08  
**Status:** Approved for implementation planning  
**Branches:** `feat/canvas-plugin`, then `feat/display-builder-plugin`

## 1. Goal

Build two dropsh plugins in two sequential phases:

1. `plugins/canvas` on branch `feat/canvas-plugin`
2. `plugins/display-builder` on branch `feat/display-builder-plugin`

Both plugins extend `dropsh schema` so an AI can build valid JSON:API payloads for Drupal builder content without relying on manual JSON knowledge.

The schema is the source of truth for how content is built. Every builder-specific detail needed to create or update content must appear in the JSON Schema returned by:

```bash
dropsh schema <entity_type>/<bundle> --for=create
dropsh schema <entity_type>/<bundle> --for=update
```

`dropsh discover` is explicitly out of scope for this spec. Discovery of existing content will be designed separately.

## 2. Context

The JSON:API research spike confirmed:

- Canvas content is writable through `/jsonapi/canvas_page/canvas_page`.
- Canvas stores its component tree in the `components` attribute on the `canvas_page` content entity.
- Display Builder content is writable through normal content entity endpoints such as `/jsonapi/node/landing_page`.
- Display Builder stores component content in one or more `ui_patterns_source` fields.
- Layout Builder write support is blocked by Drupal core access rules and is not part of this work.
- The missing piece for Canvas and Display Builder was machine-readable SDC component discovery.

The Drupal module `jsonapi_sdc` is now the required Drupal-side dependency that exposes SDC component metadata over JSON:API.

Project page: https://www.drupal.org/project/jsonapi_sdc

## 3. Non-Goals

- No Layout Builder plugin.
- No `dropsh discover` command work.
- No analysis of existing builder pages.
- No custom Drupal companion module in dropsh.
- No fallback mode without `jsonapi_sdc`.
- No UI or visual editor integration.

## 4. Hard Dependency: `jsonapi_sdc`

Both plugins require `jsonapi_sdc`.

If the module is missing, disabled, inaccessible, or its endpoint does not return usable SDC metadata, the affected builder schema must fail with a clear error. The plugin must not emit a partial builder schema that would leave the AI guessing.

Example diagnostic:

```text
Canvas plugin requires Drupal module jsonapi_sdc to build component schemas.
```

The implementation plan must verify the exact `jsonapi_sdc` endpoint and response shape in the Canvas phase before relying on it. The Drupal.org project page is currently sparse, so endpoint details are treated as an implementation verification step, not as an assumption.

## 5. Schema Contract

The schema returned by dropsh must contain enough information for an AI to produce valid JSON:API payloads.

Builder plugins extend the existing plugin hook:

```ts
extendSchema(entityType, bundle, baseSchema, ctx): Promise<unknown>
```

The current core pipeline calls `extendSchema()` before `toOperationVariant()` and does not pass the requested operation into the plugin context. Phase 1 must adjust this before implementing Canvas schema details. Acceptable designs:

- add the requested operation to `PluginContext`, then call plugins from `runSchema()` after the base schema has been converted to the create/update variant
- or add a dedicated post-operation schema hook for plugins while keeping the current pre-operation hook for source plugins such as Schemata

The implementation must preserve the existing Schemata behavior while giving builder plugins access to the final operation-specific schema they need to enrich.

The resulting schema should include:

- normal JSON Schema constraints for the JSON:API envelope
- builder-specific field shapes
- allowed component IDs
- component props
- component slots
- ID format rules
- operation-specific differences for create and update
- dropsh extension metadata under `x-dropsh-*`

Recommended extension metadata:

```json
{
  "x-dropsh-builder": "canvas",
  "x-dropsh-components": [
    {
      "id": "sdc.olivero.teaser",
      "source_id": "olivero:teaser",
      "name": "Teaser",
      "props": {},
      "slots": {}
    }
  ]
}
```

Plugins may use standard JSON Schema keywords such as `enum`, `oneOf`, `const`, `properties`, `required`, `additionalProperties`, and `description` where they help the AI build a correct payload. `x-dropsh-*` metadata is for information that is useful but awkward to express as strict JSON Schema.

## 6. Phase 1: Canvas Plugin

Branch: `feat/canvas-plugin`  
Package: `plugins/canvas`  
Public factory: `canvasPlugin()`

Required Drupal modules:

- `canvas`
- `jsonapi_sdc`

### 6.1 Target

The plugin extends only the Canvas entity schema:

```text
canvas_page/canvas_page
```

It must not affect unrelated entity types or bundles.

### 6.2 Payload Shape

Canvas uses:

```json
{
  "data": {
    "type": "canvas_page--canvas_page",
    "attributes": {
      "title": "My Canvas Page",
      "status": true,
      "components": []
    }
  }
}
```

`attributes.components` is a flat component tree. Parent-child structure is represented by `parent_uuid` and `slot`.

Each component item must be represented in the schema:

```json
{
  "uuid": "21a13483-f257-47fe-b50e-06185ef73e28",
  "component_id": "sdc.olivero.teaser",
  "parent_uuid": null,
  "slot": null,
  "inputs": {},
  "label": null
}
```

Schema requirements:

- `components` is an array.
- `uuid` is required for each item.
- `component_id` is required and must be an enum derived from `jsonapi_sdc`.
- `parent_uuid` may be `null` or a UUID string.
- `slot` may be `null` for root components or a valid slot name for child components.
- `inputs` is an object whose expected keys are derived from the selected component props.
- `component_version` is read-only and must not be required for writes.
- `inputs_resolved` is read-only and must not be required for writes.

### 6.3 Component ID Mapping

`jsonapi_sdc` exposes SDC components in Drupal SDC format, expected to be equivalent to:

```text
provider:name
```

Canvas payloads use:

```text
sdc.provider.name
```

The Canvas plugin owns this mapping.

Example:

```text
olivero:teaser -> sdc.olivero.teaser
```

The original SDC ID should remain available in `x-dropsh-components[].source_id` so other plugins can use the same source data with different ID formatting.

### 6.4 Local SDC Client

Phase 1 may implement the SDC client locally inside `plugins/canvas`, for example:

```text
plugins/canvas/src/sdc-client.ts
```

It should be written with clean boundaries:

- fetch the `jsonapi_sdc` catalog
- normalize component metadata
- report clear errors
- perform no Canvas-specific ID mapping inside the generic fetch/normalize layer

This keeps Phase 1 focused while making Phase 2 extraction possible if real reuse appears.

## 7. Phase 2: Display Builder Plugin

Branch: `feat/display-builder-plugin`  
Package: `plugins/display-builder`  
Public factory: `displayBuilderPlugin()`

Required Drupal modules:

- `display_builder`
- `ui_patterns_field`
- `display_builder_entity_view`
- `jsonapi_sdc`

Phase 2 starts only after `feat/canvas-plugin` is merged.

### 7.1 Target

The plugin extends normal content entity schemas when the bundle contains one or more `ui_patterns_source` fields.

Example target:

```text
node/landing_page
```

The plugin must leave bundles without `ui_patterns_source` fields unchanged.

### 7.2 Payload Shape

Display Builder stores one component instance per `ui_patterns_source` field.

Example field value:

```json
{
  "source_id": "component",
  "source": {
    "component": {
      "component_id": "olivero:teaser",
      "slots": {
        "title": [
          { "source_id": "textfield", "source": { "value": "My Title" } }
        ],
        "content": [
          { "source_id": "wysiwyg", "source": { "value": "<p>Body text</p>" } }
        ]
      }
    }
  },
  "third_party_settings": [],
  "node_id": ""
}
```

Schema requirements:

- each `ui_patterns_source` field is represented with the full expected object shape
- `source_id` is constrained to `"component"` for SDC component payloads
- `source.component.component_id` is an enum derived from `jsonapi_sdc`
- `slots` exposes valid slot names from the selected component
- slot values describe supported source configs such as `textfield` and `wysiwyg`
- `third_party_settings` is represented but should default to `[]`
- `node_id` is represented but should default to `""`

### 7.3 Component ID Mapping

Display Builder uses Drupal SDC IDs directly:

```text
provider:name
```

Example:

```text
olivero:teaser
```

This differs from Canvas. The Display Builder plugin must not reuse Canvas-formatted IDs in payload schemas.

### 7.4 Shared SDC Logic Decision

Phase 2 decides whether to extract the SDC client introduced in Phase 1.

Acceptable outcomes:

- keep separate local clients if the code is still small
- extract a shared internal helper if both plugins need identical fetch and normalization behavior
- create a shared package only if workspace package boundaries make that simpler and testable

Do not introduce a shared abstraction before the Display Builder implementation proves the need.

## 8. Error Handling

Errors should be explicit and builder-specific.

Expected hard failures:

- `jsonapi_sdc` endpoint is missing
- `jsonapi_sdc` response is invalid
- Canvas schema is requested but Canvas cannot be represented safely
- Display Builder schema for a target bundle needs SDC metadata but cannot load it

Expected non-failures:

- Canvas plugin receives a non-Canvas target: return schema unchanged
- Display Builder plugin receives a bundle without `ui_patterns_source` fields: return schema unchanged
- component has no props: include the component with empty props
- component has no slots: include the component with empty slots

## 9. Testing

### 9.1 Canvas Tests

Unit tests:

- `canvasPlugin().extendSchema("canvas_page", "canvas_page", base, ctx)` extends `attributes.components`.
- `jsonapi_sdc` component IDs are converted to Canvas IDs.
- props and slots from `jsonapi_sdc` are present in schema metadata.
- missing `jsonapi_sdc` produces a clear error.
- unrelated targets return the original schema unchanged.

Integration tests:

- DDEV enables `canvas` and `jsonapi_sdc`.
- `dropsh schema canvas_page/canvas_page --for=create` contains Canvas component IDs, props, and slots.
- a minimal create payload generated from the schema validates locally.

### 9.2 Display Builder Tests

Unit tests:

- plugin detects `ui_patterns_source` fields in the base schema.
- plugin extends only those fields.
- `jsonapi_sdc` component IDs remain in `provider:name` format.
- missing `jsonapi_sdc` produces a clear error when an affected bundle is extended.
- bundles without `ui_patterns_source` fields return unchanged.

Integration tests:

- DDEV enables `display_builder`, `ui_patterns_field`, `display_builder_entity_view`, and `jsonapi_sdc`.
- fixture content type has one or more `ui_patterns_source` fields.
- `dropsh schema node/<bundle> --for=create` contains Display Builder component IDs, props, slots, and field shapes.
- a minimal create payload generated from the schema validates locally.

## 10. Branch Plan

### 10.1 `feat/canvas-plugin`

Deliverables:

- `plugins/canvas`
- Canvas plugin factory and package metadata
- local SDC client
- Canvas schema extension
- unit tests
- Canvas integration fixture updates
- docs or README snippet for using `canvasPlugin()`

### 10.2 `feat/display-builder-plugin`

Prerequisite: `feat/canvas-plugin` merged.

Deliverables:

- `plugins/display-builder`
- Display Builder plugin factory and package metadata
- SDC client reuse or extraction decision
- Display Builder schema extension
- unit tests
- Display Builder integration fixture updates
- docs or README snippet for using `displayBuilderPlugin()`

## 11. Success Criteria

- `dropsh schema canvas_page/canvas_page --for=create` contains all information needed to build a Canvas JSON:API create payload.
- `dropsh schema canvas_page/canvas_page --for=update` contains all information needed to update Canvas component trees.
- `dropsh schema node/<bundle> --for=create` contains all information needed to build Display Builder `ui_patterns_source` payloads for bundles that use Display Builder fields.
- Both plugins fail clearly when `jsonapi_sdc` is unavailable.
- Core remains entity-agnostic and does not gain Canvas or Display Builder special cases.
- `discover` remains out of scope and is not implemented as part of these phases.
