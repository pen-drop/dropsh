# schema command — Design Spec

**Date:** 2026-04-23
**Status:** Approved for implementation planning
**Language:** English (per project CLAUDE.md)
**Supersedes:** Sections §7 (CLI Surface — `discover`, `schema`) and §8 (Discovery + JSON Schema) of `2026-04-21-drupal-cli-design.md`. The standalone `discover` command is removed from the CLI.

---

## 1. Purpose

Provide a single CLI surface — `drupal-cli schema` — that answers the one question an AI-driven caller needs before building a JSON:API request:

> *"What do I have to send for entity type X, bundle Y?"*

The answer is a JSON Schema document. The same schema is used by `drupal-cli create` and `drupal-cli update` for **client-side payload validation** before any HTTP request leaves the machine.

## 2. Non-goals

- No standalone `discover` command. Everything needed for orchestration (catalog + per-target schema) is served by `schema`.
- No site-wide feature detection (installed modules, Canvas components, Display Builder templates, moderation workflows). These were the job of the abandoned companion module and will be handled by separate addon/plugin work on a future branch.
- No target_bundles / cardinality enforcement for references. Relationships are shaped as JSON:API basics (`{type, id}`); richer constraints are future work.
- No plugin or addon system — those live on a separate branch.

## 3. Command Surface

```
drupal-cli schema [--refresh]
  → without a target: array of available {entity_type, bundle, label}.

drupal-cli schema <entity_type>/<bundle> [--for=create|update] [--refresh]
  → with a target: a JSON Schema document that validates a JSON:API request body
    for this resource.
    --for=create (default): required fields stay required.
    --for=update:           all fields are optional (partial PATCH semantics).
```

All stdout output is JSON. Errors go to stderr with non-zero exit codes (see §7).

## 4. Data Sources and Strategy

The `schema` command is **hybrid**: it uses the contrib module `schemata` + `schemata_json_schema` if available, and falls back to a heuristic based on sample records when it is not.

### 4.1 Catalog (no target)

Single call to the JSON:API root index:

```
GET {base_url}/{jsonapi_prefix}/
```

The response's `links` object lists every available resource type in the form `{entity_type}--{bundle}`. Parsed and returned as:

```json
[
  { "entity_type": "node",           "bundle": "article", "label": "Article" },
  { "entity_type": "node",           "bundle": "page",    "label": "Basic page" },
  { "entity_type": "taxonomy_term",  "bundle": "tags",    "label": "Tags" }
]
```

`label` is taken from the resource's `meta.title` when present; otherwise it falls back to the bundle machine name with underscores replaced by spaces and the first letter capitalized (e.g., `basic_page` → `Basic page`).

### 4.2 Per-target schema (hybrid dispatcher)

```
1. Try schemata:
     GET {base_url}/schemata/{entity}/{bundle}?_format=schema_json&_describes=api_json
     → 200 ............. return the JSON Schema, tag source="schemata"
     → 404 ............. proceed to step 2
     → other (5xx, network) → bubble up as an error

2. Fallback heuristic:
     GET {base_url}/{jsonapi_prefix}/{entity}/{bundle}?page[limit]=3
     → 200 with data[] non-empty → build a shallow schema from the sample,
                                    tag source="heuristic", emit warning
     → 200 with data[] empty    → build an envelope-only skeleton schema,
                                    tag source="heuristic-empty",
                                    emit stronger warning
     → 404                      → genuine unknown target, exit 1
     → other                    → bubble up as an error
```

The two paths produce the same envelope shape (see §5) but differ sharply in the depth of per-field information.

### 4.3 Shallow schema construction (heuristic path)

For each sample record seen:

1. Collect the union of all keys in `attributes` across samples.
2. For each attribute, infer the JSON type from the observed values:
   - `string` / `number` / `boolean` / `array` / `object` / `null`
   - `null` values do not set a type on their own; they make the field `"type": [<seen>, "null"]` if another sample had a non-null value, otherwise they stay untyped.
3. Collect the union of all keys in `relationships`. Each relationship becomes:
   ```json
   {
     "type": "object",
     "properties": {
       "data": {
         "oneOf": [
           { "type": "object", "properties": { "type": { "type": "string" }, "id": { "type": "string", "format": "uuid" } }, "required": ["type", "id"] },
           { "type": "array",  "items": { "$ref": "#/$defs/relationship_item" } },
           { "type": "null" }
         ]
       }
     }
   }
   ```
4. `required` stays empty — stock JSON:API does not expose `required` information.

### 4.4 Envelope-only skeleton (heuristic, empty bundle)

When a bundle has zero instances and `schemata` is absent, the schema carries only the fixed envelope:

```json
{
  "$schema": "https://json-schema.org/draft-07/schema",
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "type": { "const": "node--article" },
        "id":          { "type": "string", "format": "uuid" },
        "attributes":  { "type": "object" },
        "relationships": { "type": "object" }
      },
      "required": ["type"]
    }
  },
  "required": ["data"],
  "x-drupal-cli-source": "heuristic-empty"
}
```

## 5. Output Shape

Every schema document — whether from `schemata` or the heuristic — is emitted as plain JSON Schema Draft-7, with three vendor-prefixed metadata keys at the top level:

- `x-drupal-cli-source`: `"schemata" | "heuristic" | "heuristic-empty"`
- `x-drupal-cli-target`: `{ "entity_type": "...", "bundle": "..." }`
- `x-drupal-cli-operation`: `"create" | "update"`

The overall shape is:

```json
{
  "$schema": "https://json-schema.org/draft-07/schema",
  "type": "object",
  "properties": {
    "data": {
      "type": "object",
      "properties": {
        "type":            { "const": "node--article" },
        "id":              { "type": "string", "format": "uuid" },
        "attributes":      { "type": "object", "properties": { /* … */ } },
        "relationships":   { "type": "object", "properties": { /* … */ } }
      }
    }
  },
  "required": ["data"],
  "x-drupal-cli-source": "...",
  "x-drupal-cli-target": { "entity_type": "...", "bundle": "..." },
  "x-drupal-cli-operation": "..."
}
```

The exact contents of `required` arrays (at each level) are **determined by the source**: schemata returns them verbatim; the heuristic path populates only what it can prove. `--for=update` post-processing (§6) is the only place where the CLI itself rewrites required fields.

Consumers (skill, AI, direct callers) can branch on `x-drupal-cli-source` to decide how strictly to trust the schema. A heuristic schema does not guarantee that all required fields are listed.

## 6. `--for=create` vs. `--for=update`

- `--for=create` (default): the schema is returned unchanged from its source. Required fields remain required.
- `--for=update`: the schema is post-processed:
  - All `required` arrays at and below `properties.data.attributes` are cleared (`[]`).
  - `properties.data.id` becomes required at the `data` level (PATCH targets a known resource).
  - `properties.data.type` stays required (JSON:API identifies the resource by type+id).

This transformation is a pure function `toOperationVariant(schema, op)` and is applied **after** the source fetch, **before** the cache write.

## 7. Errors

| Class | Detection | Error thrown | stderr message | Exit |
|---|---|---|---|---|
| Usage error (e.g. `schema article` — missing `/`) | Argument parser | `ValidationError` | `target must be '<entity_type>/<bundle>', got '<input>'` | 4 |
| Config/auth problem | Existing loaders | `ConfigError` / `AuthError` | (surfaced from config/auth layer) | 2 / 3 |
| Network / timeout / non-2xx upstream | HTTP layer | `HttpError` | `cannot reach <url>: <underlying error>` or upstream status | 5 |
| Unknown target (both `schemata` and `/jsonapi/{e}/{b}` answer 404) | Dispatcher | `ValidationError` | `no such target '<entity>/<bundle>'. Run 'drupal-cli schema' to see available targets.` | 4 |
| Malformed schema (Ajv `compile` throws) | Validator bootstrap | `ValidationError` | `schema for <target> returned by 'schemata' cannot be compiled: <ajv error>. Try --refresh, or check the schemata module version.` | 4 |
| Cache read corrupt (`JSON.parse` throws) | `file-store.ts` | — (warning) | `warning: cache file <path> was unreadable and has been refetched` | 0 |
| Cache write failed | `file-store.ts` | — (warning) | `warning: could not update cache at <path>: <reason>` | 0 |
| Payload validation failed (from `create`/`update`) | `validate.ts` | `ValidationError` with `details.errors` = Ajv error list | structured JSON: `{error: {code: "E_VALIDATION", message, details: {errors: [...]}}}` | 4 |
| Warning: heuristic schema returned | Dispatcher | — (warning) | `warning: site has no 'schemata' module; returning heuristic schema (no required fields, no constraints)` | 0 |
| Warning: heuristic empty bundle | Dispatcher | — (warning) | `warning: bundle '<e>/<b>' has no instances and no 'schemata' module; returning envelope-only schema` | 0 |

Exit codes follow the existing convention in `src/errors.ts`: `0` success, `1` unknown error (fallback), `2` ConfigError, `3` AuthError, `4` ValidationError, `5` HttpError.

## 8. Caching

### 8.1 Location and layout

Cache is rooted at `.drupal-cli/cache/`, relative to the directory holding `.drupal-cli.yml`:

```
.drupal-cli/cache/
  catalog.json                              # `schema` without target
  schema/node--article.create.json          # per-bundle × operation
  schema/node--article.update.json
  schema/taxonomy_term--tags.create.json
  …
```

A gitignore entry for `.drupal-cli/cache/` is documented in the README.

### 8.2 Read/write semantics

- No TTL. Cache is valid until `--refresh` or `drupal-cli clean` (separate command, separate spec).
- Read miss → fetch → write → return.
- Read hit → return.
- `--refresh` → fetch → write (overwrite) → return.
- All writes are atomic: write to `<final>.tmp`, `fsync` (best-effort), `rename` over the final path.
- A corrupt cache file (fails `JSON.parse`) is treated as a miss and refetched; a warning is printed.
- A failing write does not fail the command; a warning is printed and the fresh response is still emitted to stdout.

## 9. Client-side Validation and Integration with `create`/`update`

The `validate.ts` module compiles a given schema with Ajv (Draft-7 meta loaded) and returns structured validation errors. It is consumed by:

- `drupal-cli create <entity> --bundle=<bundle> --data=@file` — before sending, the payload is validated against `schema/<e>--<b>.create.json` (loaded from cache or fetched on demand).
- `drupal-cli update <target> --data=@file` — same, against the `.update.json` variant.

Behavior when validation fails:

- A `ValidationError` is thrown with `details.errors` set to the Ajv error list; the CLI's existing error handler surfaces it on stderr and sets exit code **4**.
- No HTTP request is made.
- stderr payload shape (from `createOutput().fail`): `{ "error": { "code": "E_VALIDATION", "message": "payload does not match schema for <target>", "details": { "errors": [{ "instancePath": "/data/attributes/title", "message": "must be string", "params": { ... } }, …] } } }`.

Behavior when the schema source is `heuristic` or `heuristic-empty`:

- Validation still runs; it can still reject structural or type mistakes.
- The caller cannot rely on required-field enforcement. The server's 422 response remains the final authority in that case.

**Opt-out:** a `--no-validate` flag on `create`/`update` bypasses client-side validation (escape hatch for debugging or future edge cases). Default is validation on.

## 10. Module Layout

```
src/
  commands/
    schema.ts                     # dispatcher: no arg → catalog; arg → per-target schema
  core/
    schema/
      catalog.ts                  # GET /jsonapi → [{entity_type, bundle, label}]
      sources/
        schemata.ts               # GET /schemata/... → raw JSON Schema
        heuristic.ts              # GET /jsonapi/{e}/{b}?page[limit]=3 → shallow schema
      jsonschema-source.ts        # facade: try schemata → fallback to heuristic
      to-jsonschema.ts            # --for=create|update post-processing
      validate.ts                 # Ajv wrapper: compile + validate with typed errors
    cache/
      file-store.ts               # .drupal-cli/cache/ atomic read/write
```

Three small units with clear seams: **catalog** (what exists?), **source** (what does a bundle look like?), **validator** (is this payload OK?). All three are pure functions over injected `HttpClient`/`AuthAdapter` — unit-testable without HTTP.

Touchpoints in existing code:

- `src/index.ts` — register the new `schema` command.
- `src/commands/create.ts`, `src/commands/update.ts` — integrate the validator step and the `--no-validate` flag.
- `src/errors.ts` — confirm / reuse existing exit code constants.

## 11. Testing

### 11.1 Unit tests (`tests/unit/`, Vitest, injected deps)

| File | Scope |
|---|---|
| `core/schema/catalog.test.ts` | Parse JSON:API root index → `[{entity_type, bundle, label}]`. Happy path, response without `links`, empty catalog, single-bundle entity types (e.g. `user`). |
| `core/schema/sources/schemata.test.ts` | URL construction, 200, 404, 5xx, non-JSON response, malformed body. |
| `core/schema/sources/heuristic.test.ts` | Build shallow schema from 0 / 1 / 3 sample records. Key union, type inference including `null`, relationships as arrays vs. singletons. |
| `core/schema/jsonschema-source.test.ts` | Dispatcher: schemata-hit returns with `source="schemata"`; schemata-404 triggers heuristic with `source="heuristic"`; both-404 returns error. |
| `core/schema/to-jsonschema.test.ts` | `--for=create` leaves schema intact; `--for=update` clears `required` at `data.attributes`, keeps `data.type` and adds `data.id` required. |
| `core/schema/validate.test.ts` | Ajv compiles Draft-7 schema; valid payload passes; missing required field produces a typed error with expected `instancePath`. |
| `core/cache/file-store.test.ts` | Atomic write (tmp → rename), read-miss, corrupt-JSON, fs permission errors. |
| `commands/schema.test.ts` | End-to-end of the command layer with mocked HTTP and cache: no-arg → catalog; target → schema; `--refresh` bypasses cache; error paths. |

### 11.2 Fixtures

```
tests/unit/fixtures/
  jsonapi-root.json                                     # JSON:API root index sample
  schemata/node--article.schema.json                    # real schemata_json_schema dump
  samples/node--article-3-records.json                  # sample records for heuristic
  samples/node--empty-bundle.json                       # {"data": []}
  payloads/article-valid.json                           # passes validation
  payloads/article-missing-title.json                   # fails validation
```

### 11.3 Integration tests (`tests/integrations/schema/`, against DDEV)

Two DDEV setups under `tests/integrations/`:

- **`drupal/`** — existing baseline, no `schemata` module. All existing integration tests continue to use this setup.
- **`drupal-schemata/`** — new setup: baseline + `drupal/schemata` + `drupal/schemata_json_schema`.

Test assignment:

| Test | DDEV setup |
|---|---|
| `schema-list.integration.test.ts` | baseline |
| `schema-heuristic.integration.test.ts` | baseline |
| `schema-heuristic-empty-bundle.integration.test.ts` | baseline |
| `schema-refresh.integration.test.ts` | baseline |
| `schema-cache-persistence.integration.test.ts` | baseline |
| `schema-unknown-target.integration.test.ts` | baseline |
| `schema-jsonschema-create.integration.test.ts` | drupal-schemata |
| `schema-jsonschema-update.integration.test.ts` | drupal-schemata |
| `schema-validates-create-payload.integration.test.ts` | drupal-schemata |

Each test sets up its DDEV setup explicitly (boot, teardown) through helpers under `tests/integrations/helpers/`.

### 11.4 TDD order in the plan

1. `cache/file-store` — tests + implementation (no external deps).
2. `schema/validate` — tests + implementation (only depends on Ajv).
3. `schema/to-jsonschema` — tests + implementation.
4. `schema/sources/schemata` — tests + implementation.
5. `schema/sources/heuristic` — tests + implementation.
6. `schema/jsonschema-source` — tests + implementation (composes 4 and 5).
7. `schema/catalog` — tests + implementation.
8. `commands/schema` — tests + implementation (composes catalog + source + cache).
9. `create`/`update` integration — tests + `--no-validate` flag + validator step.
10. Integration tests for all of the above.

## 12. Out of scope / future

- Addon/plugin system that feeds `x-drupal-cli-source: "plugin:<name>"` fragments into the schema.
- Reference constraints (`target_bundles`, cardinality) from field config.
- `drupal-cli clean` — cache eviction command (separate tiny spec).
- OpenAPI-3-based schema source (`openapi` + `openapi_jsonapi`) as an alternative to `schemata`.
- Automatic schema refresh on known config-change events from Drupal.
- Normalization of Draft-7 to Draft 2020-12 on the CLI side.
