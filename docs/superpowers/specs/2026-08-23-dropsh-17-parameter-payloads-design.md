# Dynamic entity parameter population (DROPSH-17)

## Problem

`dropsh create` and `dropsh update` accept exactly the JSON:API document that
goes over the wire, via `--data <json>` or `--data @file`. The CLI already knows
the bundle's schema — it fetches it, applies plugin extensions to it, caches it,
and validates the payload against it — but exposes none of that knowledge on the
command line.

Every caller therefore hand-builds the document. For the dropsh Skill this is
the dominant cost: setting one field means reconstructing and re-emitting the
whole payload, and a field added to the schema is invisible until the Skill's own
prose is updated.

The knowledge needed to avoid this is already in the resolved schema:

- `properties.data.properties.attributes.properties.*` and
  `properties.data.properties.relationships.properties.*` separate attributes
  from relationships.
- Both objects carry `additionalProperties: false`, so the schema is
  authoritative about which field names exist.
- `properties.data.properties.type.const` carries the resource type.
- A relationship's allowed target types are in
  `relationships.<field>.properties.data.properties.type.enum` (single-valued) or
  `…data.items.properties.type.enum` (multi-valued), which also distinguishes
  single from multi.

## Goals

- Build a valid JSON:API document from named field parameters on `create` and
  `update`, deriving attribute/relationship placement from the resolved schema.
- Reject a parameter the resolved schema does not know, before any write reaches
  the wire.
- Accept a relationship as a bare UUID and resolve its `type` from the schema.
- Honour `extendOperationSchema` plugin extensions with no extra code path.
- Expose the builder as a programmatic API a plugin can call without the CLI.
- Build PATCH documents for `update` the same way.
- Leave every existing `--data` invocation producing and sending the identical
  payload.

## Non-goals

- A separate `generate` command. `--dry-run` already prints the document it would
  send; a second command surface would duplicate it.
- A parser plugin. See *Rejected alternatives*.
- Index-path syntax for arrays of objects (`--links.0.uri`). The explicit
  `--json <field>=<json>` escape covers `links`/`metrics` without a second
  path grammar.
- Updating the dropsh Skill or `modes/*.md` to use the new interface. CLI help
  text ships with this change; the Skill migration is a follow-up.
- Changing the target syntax of `create`. It stays
  `create <entity_type> --bundle <bundle>`; see *Command surface*.

## Command surface

`create <entity_type> --bundle <bundle>` and `update <entity_type>/<bundle>/<uuid>`
keep their present shape. The briefing spelled AC 1 as `dropsh create
node/article`, but the qualification handoff's checkable restatement requires
only that a `create` invocation *carry a `title` parameter and a nested
`body.value` parameter*, and it delegated the command-surface question to this
spec. Adding a second target spelling would buy nothing and would have to
coexist with `--bundle` forever.

Field parameters are free-form long options; the command gains
`allowUnknownOption()` and reads them from `cmd.args`:

```
dropsh create node --bundle article --title "Test" --body.value "Text"
dropsh update node/article/<uuid> --title "New title"
```

Four forms are recognised, all feeding one ordered parameter list:

| Form | Meaning |
|---|---|
| `--<path> <value>` | one field, or one sub-property via a dotted path |
| `--<path>=<value>` | same; required when the value itself starts with `--` |
| `--set <path>=<value> …` | variadic; many fields in one flag (AC 2) |
| `--json <path>=<json>` | raw JSON value, for arrays of objects |

`--set` is also the only route to a field whose name collides with a reserved
option (`--bundle`, `--data`, `--dry-run`, `--no-validate`, and the
program-level `--format`, `--auth-profile`, `--config`, `--view-mode`).
`--set` and `--json` are themselves reserved in the field region, so a field
actually named `set` or `json` is reachable only as `--set set=…` /
`--set json=…`. **Reserved always wins**: a reserved option is consumed by Commander before the
field parser sees `cmd.args`, so intent cannot be recovered. The command's
`--help` text and the unknown-parameter error both name `--set <field>=…` as the
reliable route.

Commander's behaviour was verified against the installed version: with
`allowUnknownOption()`, `cmd.args` is `[<positional>, …unknown tokens in argv
order]`, reserved options are removed, program-level options are hoisted, and
`--title=Hello World` stays one token — including when field flags precede
`--bundle`.

### Values

Coercion is driven by the leaf schema node, not by guessing:

- `type: boolean` — `"true"`/`"false"`; a bare `--closed` with no value means
  `true`. On any other type a missing value is an error.
- `type: integer` / `number` — parsed numerically; a non-numeric value is an
  error even under `--no-validate`, because it is a build failure rather than a
  validation failure.
- everything else — the string as given.

Relationships take a bare UUID and gain `type` from the schema:

```
--assignee_user_id 3b72a85c-…        →  relationships.assignee_user_id.data
--labels <uuid> --labels <uuid>      →  relationships.labels.data[]  (multi-valued)
```

Repetition accumulates on a multi-valued field. There is no comma splitting, so
`--title "a, b"` stays intact. When a relationship's schema allows more than one
target type, the bare form is ambiguous and `<type>:<uuid>` is required; the
error lists the allowed types.

A path given twice for a single-valued field is an **error**, not last-wins.

## Architecture

Three new modules, none of which touches the network, Commander, or each other's
concern:

```
src/core/params/parse-args.ts         argv fragment → parameter list   (no schema)
src/core/payload/schema-fields.ts     schema → field index             (no argv)
src/core/payload/from-parameters.ts   (schema, parameters) → document  (no argv)
```

`from-parameters.ts` and `schema-fields.ts` are exported from
`src/plugin-api.ts` (AC 7). `parse-args.ts` stays internal: it encodes CLI
conventions, not domain knowledge, and a plugin holding a schema does not need
it.

### `schema-fields.ts`

```ts
export interface FieldDescriptor {
  name: string;
  kind: "attribute" | "relationship";
  node: unknown;            // the field's own subschema
  targetTypes?: string[];   // relationship: data(.items).properties.type.enum|const
  multiple?: boolean;       // relationship: data is an array
}

export interface SchemaFieldIndex {
  resourceType?: string;    // data.properties.type.const, else enum[0]
  fields: Map<string, FieldDescriptor>;
  order: string[];          // schema declaration order: attributes, then relationships
}

export function indexSchemaFields(schema: unknown): SchemaFieldIndex;
```

Three consumers need this index: the builder, the unknown-parameter error, and
the `--help` text. Without it the same schema navigation would appear three
times.

### `parse-args.ts`

```ts
export interface RawParameter {
  path: string;
  value: string;
  form: "flag" | "set" | "json";
  hasValue: boolean;
}

export function parseFieldArgs(tokens: string[]): RawParameter[];
```

A bare `--field` yields `hasValue: false` and stays legal here; whether that
means `true` or an error is a schema question, decided in the builder. A
positional in the field region is an error.

### `from-parameters.ts`

```ts
export interface BuildPayloadInput {
  schema: unknown;
  parameters: RawParameter[];
  operation: "create" | "update";
  id?: string;              // update: data.id
  resourceType?: string;    // fallback when the schema carries no type const
}

export function buildPayloadFromParameters(input: BuildPayloadInput): unknown;
```

Emits `data.type` from the index, falling back to the caller-supplied
`resourceType` (the CLI passes `<entity>--<bundle>`) when the schema carries no
`const`, and erroring when neither is available. Emits `data.id` for `update`,
and omits `attributes` or
`relationships` entirely when no parameter targets them — so an `update`
document carries only the supplied fields (AC 8).

Keys are emitted in **schema declaration order**, not argv order: `data` carries
`type`, then `id` (update only), then `attributes`, then `relationships`; within
each of those, fields follow `SchemaFieldIndex.order`, and within a field, its
sub-properties follow that field's own subschema order. Two
invocations that set the same fields therefore produce the identical byte
string regardless of flag order, which is what makes AC 2's "byte-identical"
requirement hold structurally rather than coincidentally, and makes two
`--dry-run` outputs diffable.

## Data flow

`create` (`update` is identical apart from `data.id` from the target UUID):

1. `--data` changes from `.requiredOption` to `.option`; the command gains
   `.allowUnknownOption()`.
2. `parseFieldArgs(cmd.args.slice(1))` — `cmd.args[0]` is the positional.
3. Both `--data` and field parameters present → `ValidationError`. Neither →
   `ValidationError` naming both routes.
4. `--data` only → today's path, unchanged (AC 9).
5. Field parameters only → resolve the schema, build the document, hand it to
   the existing command function.

`CreateArgs` and `UpdateArgs` gain an optional `payload?: unknown` and make
`dataArg` optional; `runCreate`/`runUpdate` use
`args.payload ?? await readDataArg(args.dataArg)`. Everything downstream of that
line — `deps.validate`, the `dryRun` branch, `client.post`/`client.patch` — is
untouched. This is what makes AC 6 fall out for free: `--dry-run` keeps emitting
`{ dry_run, method, path, payload }` and issues no write.

The schema comes from the existing `loadOrFetchSchema(ctx, target, op)`
(`src/index.ts:302`), which already applies `applyOperationSchemaPlugins()` and
caches per operation and hook-plugin set. Because the builder reads that same
resolved object, **AC 5 holds structurally**: a field contributed by
`extendOperationSchema` is indistinguishable from a native one in the index, and
a field no plugin contributed stays unknown.

It is fetched once per invocation and memoised for both the builder and the
validator:

```ts
let cached: unknown;
const schema = async () => (cached ??= await loadOrFetchSchema(ctx, target, "create"));
```

One consequence is explicit: in parameter mode the schema is **always** loaded,
including under `--no-validate`, because attribute/relationship placement is
impossible without it. `--no-validate` now means "skip Ajv", not "skip the
schema". In `--data` mode nothing changes: no schema is fetched under
`--no-validate`, exactly as today.

## Errors

Every parser and builder failure is a `ValidationError` → `E_VALIDATION`, exit
code **4** (`src/errors.ts:58`), raised **before** any write request. The only
HTTP traffic that can precede it is the schema GET, so AC 3 is not merely "an
error is reported" but "the rejected parameter never reaches the wire".

| Condition | Message names |
|---|---|
| unknown parameter | the rejected name, plus the known attributes and relationships, listed separately |
| unknown path segment in a known field | the segment and the field's known sub-properties |
| missing value on a non-boolean field | the field and its schema type |
| a path given twice on a single-valued field | the field |
| ambiguous relationship target type | the allowed types and the `<type>:<uuid>` form |
| invalid `--json` value | the field and the JSON parse error |
| non-coercible value | the field, the value, and the expected type |
| `--data` together with field parameters | both routes are mutually exclusive |
| neither `--data` nor any field parameter | both routes |

A field whose name is a reserved option cannot be detected as such at parse
time; the unknown-parameter error and `--help` therefore both point at
`--set <field>=…` unconditionally.

## Testing

Unit (`pnpm test`), no network. One new fixture,
`tests/unit/fixtures/schemata/node--article.rich.schema.json`, holds a raw
schemata-shaped schema modelled on the real cached ones (scalar, boolean,
integer, nested-object and array-of-object attributes; single-valued,
multi-valued and ambiguous-target relationships). Both operation variants are
derived from it in the tests with the real `toOperationVariant()`, so the
fixture cannot drift from the pipeline:

| File | Covers |
|---|---|
| `tests/unit/core/params/parse-args.test.ts` | all four flag forms, `--set` variadic, `--x=y`, argv order, positional in the field region |
| `tests/unit/core/payload/schema-fields.test.ts` | attribute/relationship split, `multiple` on `labels`, `targetTypes`, `resourceType` from `const` |
| `tests/unit/core/payload/from-parameters.test.ts` | AC 1, 2, 3, 4, 7, 8; coercion, duplicate rejection, ambiguous target type, `--json` |
| `tests/unit/commands/create.test.ts`, `update.test.ts` | payload injection, mutual exclusion; existing `--data` cases stay green (AC 9) |
| `tests/unit/index.test.ts` | CLI wiring, `--dry-run` emitting no POST (AC 6) against a fake client, a fake plugin's `extendOperationSchema` field accepted while an uncontributed one is still rejected (AC 5) |

Each CLI test builds a fresh `buildProgram()`: Commander accumulates option
state on a reused `Command` instance across `parse` calls, which was observed
while verifying `allowUnknownOption()`.

Integration (`pnpm run test:integration`, live DDEV): one `create` and one
`update` driven entirely by parameters against the real site, reading the
written field values back. This is the only check that proves Drupal accepts the
document, rather than proving Ajv does.

Gate: `pnpm run lint`, `pnpm run typecheck`, `pnpm test` green;
`pnpm run test:integration` green against a live DDEV instance.

## Rejected alternatives

**A parser plugin (briefing option 2/3).** The plugin route cannot avoid core
changes: building a payload requires the resolved operation schema, and
`src/plugin-api.ts` exports neither `loadOrFetchSchema`, nor `validatePayload`,
nor any factory for an authenticated `CommandContext` (only the type). It would
also need `registerCommands`, which no plugin in this repository uses. A plugin
command that sends would satisfy AC 1 and AC 8 in substance but not in wording,
since the invocation carrying the named parameters would not be `create`.

**A pure generator plus shell composition** (`dropsh generate … | dropsh create
--data @-`). Cleanest separation and needs no change to `create`, but AC 1 and
AC 8 would then be met by a two-command pipeline rather than one invocation —
an acceptance deviation, not a design choice this spec can make.

**A separate `generate` command in core (briefing option 4).** Functionally
identical to `create --dry-run`, so it adds a second surface for the same
behaviour.

**Index-path syntax for arrays of objects.** `--links.0.uri=…` needs rules for
index gaps, ordering, and conflict with `--json links=…`; the JSON escape covers
the same ground at a fraction of the cost.

**Last-wins on a duplicate parameter.** Silent precedence hides a typo in a long
`--set` list. Rejecting it costs one comparison.

## Acceptance criteria

Numbering follows the qualification handoff.

1. **Build and send from named field parameters** — `from-parameters.ts` places
   `title` under `attributes` and `body.value` under `attributes.body.value` from
   the schema, and the document flows into the unchanged `validate → post` path.
2. **Many fields in one invocation** — `--set` and per-field flags feed one
   parameter list, and schema key ordering makes the output byte-identical
   regardless of flag order.
3. **Unknown parameter is rejected** — `additionalProperties: false` makes the
   index authoritative; the error is a `ValidationError` (exit 4) raised before
   any write.
4. **Relationship from a bare UUID** — `type` from `targetTypes`, `id` from the
   UUID, single or array per `multiple`.
5. **Plugin schema extensions are honoured** — the builder reads the same
   `applyOperationSchemaPlugins()` output the validator does.
6. **Dry-run prints without sending** — the existing `--dry-run` branch is
   untouched and now receives a generated payload.
7. **Programmatic API** — `buildPayloadFromParameters` and `indexSchemaFields`
   exported from `dropsh/plugin`, unit-tested without the CLI.
8. **`update` builds PATCH the same way** — same builder, `operation: "update"`,
   `data.id` from the target, only supplied fields emitted.
9. **Existing `--data` path unchanged** — `--data` mode takes the same branch it
   takes today; the existing unit and integration suites stay green.

---

## Amendments

Recorded after the fact, during the second `coding` run, because the review of
commit `9618a7e` found two deviations from this document that had shipped
without an amendment. The body above is left exactly as it was confirmed; what
changed is stated here.

### A1 — `--set` was dropped (commit `3c8692c`)

**Confirmed above:** four surface forms, with `--set <path>=<value> …` as AC 2's
vehicle and as the only route to a field whose name collides with a reserved
option.

**Shipped:** three forms. `--set` is gone; it is an ordinary field name again
(`parseFieldArgs(["--set", "title=T"])` yields the field `set`).

**Why:** `--set <path>=<value>` and `--<path>=<value>` differ only in a prefix
token. The pair form already puts an arbitrary number of fields into one
invocation, so `--set` bought a second spelling of AC 2 and nothing else, at the
cost of a reserved word that then had to be escaped from itself
(`--set set=…`).

**Effect on acceptance:** none. AC 2 is carried by the `--<field>=<value>` pair
form and proved by `from-parameters.test.ts` — *"AC 2: the key=value list form is
byte-identical to the spaced form"*.

**Effect on the reserved-name escape:** the escape is `--json <field>=<json>`,
not `--data` alone. The collector name is matched before any other handling
(`src/core/params/parse-args.ts`), so the pair's left-hand side is an arbitrary
field path — including one that collides with a reserved option, or `json`
itself. Only the bare `--<field>` form is out of reach. The claim in *Surface*
above that `--set` is "the only route", and the `--data`-only wording that
initially shipped in `README.md` and `FIELD_PARAMETER_HELP`, are both superseded
by this paragraph.

### A2 — `--fields` was added (commits `75f5b98`, `892b8e1`, `8cf2533`, `9c6568e`)

**Not in this document at all.** `create`, `update` and `schema` gained a
`--fields` flag that resolves the bundle's operation schema and prints every
settable parameter as an aligned table (`--format json` yields the same listing
as data), then exits without sending. `src/core/params/help.ts` holds
`describeFields`, `renderFieldsTable` and `FIELD_PARAMETER_HELP`.

**Why:** the design leans on "the schema is authoritative about which field
names exist" for AC 3, but gave the caller no way to *read* that list. Commander
renders `--help` synchronously and so cannot resolve a schema, which is why the
listing is an action-time flag rather than help text.

**Effect on acceptance:** none — it adds no criterion and weakens none. It is
unit-covered (`tests/unit/core/params/help.test.ts`) and reachable three ways,
all from the schema alone with no extra request.

**Consequence for the reserved list:** `--fields` joins the reserved options, so
it is named in the list `FIELD_PARAMETER_HELP` and `README.md` print.
