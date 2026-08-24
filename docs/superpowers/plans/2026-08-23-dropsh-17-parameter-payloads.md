# Dynamic entity parameter population Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `dropsh create` and `dropsh update` build a valid JSON:API document from named field parameters, derived entirely from the resolved operation schema, and expose the builder as a programmatic API.

**Architecture:** Three new side-effect-free modules — an argv parser that knows no schema, a schema field index, and a builder that turns (schema, parameters) into a document. `create`/`update` keep their whole existing pipeline; when no `--data` is given, the builder's output is injected at the one point where `--data` used to be parsed, so validation, dry-run and sending are untouched.

**Tech Stack:** TypeScript (ESM, NodeNext), Commander 12, Ajv 8, vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-23-dropsh-17-parameter-payloads-design.md`

## Global Constraints

- **English only** in code, identifiers, comments, CLI help text, error messages, JSON output, docs and commit messages (`CLAUDE.md`).
- **Before every commit:** `pnpm run lint`, `pnpm run typecheck`, `pnpm test` must pass. Auto-fix with `pnpm run lint:fix`.
- **Node 20+**; tests run on Node 20 and 22 in CI.
- **No behaviour change to the `--data` path.** Every existing `--data <json>` / `--data @file` invocation of `create` and `update` must produce and send the identical payload; the existing suites are the guard.
- **All parser/builder failures are `ValidationError`** (`src/errors.ts:26`) → code `E_VALIDATION`, exit code 4, raised before any write request.
- **Exact TS style of this repo:** ESM imports carry the `.js` extension (`import { x } from "./y.js"`), `exactOptionalPropertyTypes` is on — build optional properties conditionally (`...(v !== undefined ? { k: v } : {})`) instead of assigning `undefined`.
- **Field parameters are never comma-split.** `--title "a, b"` must survive intact.
- **`__dirname` does not exist** in these ESM test files. Every test that reads a fixture resolves its own directory the way `tests/unit/package-types.test.ts` does, and all fixture paths below are relative to `here`:
  ```ts
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  const here = dirname(fileURLToPath(import.meta.url));
  ```
- **Output key order is canonical:** `data.type`, then `data.id` (update only), then `attributes`, then `relationships`; fields in schema declaration order; sub-properties in their own subschema's order.

---

### Task 1: Schema field index

Builds the one lookup every later task reads: which field names exist, whether each is an attribute or a relationship, and for relationships which resource types they accept and whether they are multi-valued.

**Files:**
- Create: `tests/unit/fixtures/schemata/node--article.rich.schema.json`
- Create: `src/core/payload/schema-fields.ts`
- Test: `tests/unit/core/payload/schema-fields.test.ts`

**Interfaces:**
- Consumes: `toOperationVariant` from `src/core/schema/to-jsonschema.ts` (test-side only, to derive both operation variants from the raw fixture).
- Produces:
  ```ts
  export interface FieldDescriptor {
    name: string;
    kind: "attribute" | "relationship";
    node: unknown;
    targetTypes?: string[];
    multiple?: boolean;
  }
  export interface SchemaFieldIndex {
    resourceType?: string;
    fields: Map<string, FieldDescriptor>;
    order: string[];
  }
  export function indexSchemaFields(schema: unknown): SchemaFieldIndex;
  export function propertiesOf(node: unknown): Record<string, unknown> | undefined;
  ```

- [ ] **Step 1: Write the fixture**

Create `tests/unit/fixtures/schemata/node--article.rich.schema.json`. This is a *raw* schemata-shaped schema (not yet operation-specialised), modelled on the real cached schemas in `.dropsh/cache/`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["data"],
  "properties": {
    "data": {
      "type": "object",
      "required": ["type", "attributes"],
      "properties": {
        "type": { "const": "node--article" },
        "id": { "type": "string", "format": "uuid" },
        "attributes": {
          "type": "object",
          "additionalProperties": false,
          "required": ["title"],
          "properties": {
            "title": { "type": "string", "maxLength": 255 },
            "status": { "type": "boolean" },
            "weight": { "type": "integer" },
            "body": {
              "type": "object",
              "required": ["value"],
              "properties": {
                "value": { "type": "string" },
                "format": { "type": "string" },
                "summary": { "type": "string" }
              }
            },
            "links": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "uri": { "type": "string", "format": "uri" },
                  "title": { "type": "string" }
                }
              }
            }
          }
        },
        "relationships": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "uid": {
              "type": "object",
              "properties": {
                "data": {
                  "type": "object",
                  "required": ["type", "id"],
                  "properties": {
                    "type": { "type": "string", "enum": ["user--user"] },
                    "id": { "type": "string", "format": "uuid" }
                  }
                }
              }
            },
            "field_tags": {
              "type": "object",
              "properties": {
                "data": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["type", "id"],
                    "properties": {
                      "type": { "type": "string", "enum": ["taxonomy_term--tags"] },
                      "id": { "type": "string", "format": "uuid" }
                    }
                  }
                }
              }
            },
            "field_ref": {
              "type": "object",
              "properties": {
                "data": {
                  "type": "object",
                  "required": ["type", "id"],
                  "properties": {
                    "type": { "type": "string", "enum": ["node--article", "node--page"] },
                    "id": { "type": "string", "format": "uuid" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/core/payload/schema-fields.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexSchemaFields, propertiesOf } from "../../../../src/core/payload/schema-fields.js";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "../../fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;

const createSchema = toOperationVariant(RAW, "create");
const updateSchema = toOperationVariant(RAW, "update");

describe("indexSchemaFields", () => {
  it("reads the resource type from data.properties.type.const", () => {
    expect(indexSchemaFields(createSchema).resourceType).toBe("node--article");
  });

  it("classifies attributes and relationships", () => {
    const index = indexSchemaFields(createSchema);
    expect(index.fields.get("title")?.kind).toBe("attribute");
    expect(index.fields.get("body")?.kind).toBe("attribute");
    expect(index.fields.get("uid")?.kind).toBe("relationship");
    expect(index.fields.get("field_tags")?.kind).toBe("relationship");
  });

  it("knows nothing about a field the schema does not declare", () => {
    expect(indexSchemaFields(createSchema).fields.has("titel")).toBe(false);
  });

  it("resolves a single-valued relationship's target type", () => {
    const uid = indexSchemaFields(createSchema).fields.get("uid");
    expect(uid?.targetTypes).toEqual(["user--user"]);
    expect(uid?.multiple).toBe(false);
  });

  it("marks an array-valued relationship as multiple", () => {
    const tags = indexSchemaFields(createSchema).fields.get("field_tags");
    expect(tags?.targetTypes).toEqual(["taxonomy_term--tags"]);
    expect(tags?.multiple).toBe(true);
  });

  it("keeps every allowed target type of an ambiguous relationship", () => {
    expect(indexSchemaFields(createSchema).fields.get("field_ref")?.targetTypes).toEqual([
      "node--article",
      "node--page",
    ]);
  });

  it("orders attributes in schema declaration order, then relationships", () => {
    expect(indexSchemaFields(createSchema).order).toEqual([
      "title",
      "status",
      "weight",
      "body",
      "links",
      "uid",
      "field_tags",
      "field_ref",
    ]);
  });

  it("indexes the update variant identically", () => {
    const index = indexSchemaFields(updateSchema);
    expect(index.resourceType).toBe("node--article");
    expect(index.fields.get("title")?.kind).toBe("attribute");
  });

  it("returns an empty index for a schema without a data object", () => {
    const index = indexSchemaFields({ type: "object" });
    expect(index.fields.size).toBe(0);
    expect(index.order).toEqual([]);
    expect(index.resourceType).toBeUndefined();
  });

  it("exposes a field's sub-properties", () => {
    const body = indexSchemaFields(createSchema).fields.get("body");
    expect(Object.keys(propertiesOf(body?.node) ?? {})).toEqual(["value", "format", "summary"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/core/payload/schema-fields.test.ts`
Expected: FAIL — cannot resolve `src/core/payload/schema-fields.js`.

- [ ] **Step 4: Implement the index**

Create `src/core/payload/schema-fields.ts`:

```ts
export interface FieldDescriptor {
  name: string;
  kind: "attribute" | "relationship";
  /** The field's own subschema, as declared under attributes/relationships. */
  node: unknown;
  /** Relationship only: the resource types its `data.type` accepts. */
  targetTypes?: string[];
  /** Relationship only: true when `data` is an array. */
  multiple?: boolean;
}

export interface SchemaFieldIndex {
  /** From `data.properties.type.const`, else the first `enum` entry. */
  resourceType?: string;
  fields: Map<string, FieldDescriptor>;
  /** Schema declaration order: attributes first, then relationships. */
  order: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `properties` map of a schema node, or undefined when it has none. */
export function propertiesOf(node: unknown): Record<string, unknown> | undefined {
  if (!isRecord(node)) return undefined;
  const props = node.properties;
  return isRecord(props) ? props : undefined;
}

function resourceTypeOf(dataNode: unknown): string | undefined {
  const typeNode = propertiesOf(dataNode)?.type;
  if (!isRecord(typeNode)) return undefined;
  if (typeof typeNode.const === "string") return typeNode.const;
  if (Array.isArray(typeNode.enum) && typeof typeNode.enum[0] === "string") {
    return typeNode.enum[0];
  }
  return undefined;
}

/**
 * A relationship declares its payload under `data`, either as a single resource
 * identifier object or as an array of them. Both carry the allowed resource
 * types in their `type` node's `enum`/`const`, which is what lets a bare UUID on
 * the command line become a complete identifier object.
 */
function describeRelationship(name: string, node: unknown): FieldDescriptor {
  const dataNode = propertiesOf(node)?.data;
  const multiple = isRecord(dataNode) && dataNode.type === "array";
  const itemNode = multiple ? (dataNode as Record<string, unknown>).items : dataNode;
  const typeNode = propertiesOf(itemNode)?.type;
  let targetTypes: string[] | undefined;
  if (isRecord(typeNode)) {
    if (Array.isArray(typeNode.enum)) {
      targetTypes = typeNode.enum.filter((t): t is string => typeof t === "string");
    } else if (typeof typeNode.const === "string") {
      targetTypes = [typeNode.const];
    }
  }
  return {
    name,
    kind: "relationship",
    node,
    multiple,
    ...(targetTypes !== undefined ? { targetTypes } : {}),
  };
}

export function indexSchemaFields(schema: unknown): SchemaFieldIndex {
  const dataNode = propertiesOf(schema)?.data;
  const dataProps = propertiesOf(dataNode);
  const fields = new Map<string, FieldDescriptor>();
  const order: string[] = [];

  for (const [name, node] of Object.entries(propertiesOf(dataProps?.attributes) ?? {})) {
    fields.set(name, { name, kind: "attribute", node });
    order.push(name);
  }
  for (const [name, node] of Object.entries(propertiesOf(dataProps?.relationships) ?? {})) {
    fields.set(name, describeRelationship(name, node));
    order.push(name);
  }

  const resourceType = resourceTypeOf(dataNode);
  return { fields, order, ...(resourceType !== undefined ? { resourceType } : {}) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/core/payload/schema-fields.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/core/payload/schema-fields.ts tests/unit/core/payload/schema-fields.test.ts tests/unit/fixtures/schemata/node--article.rich.schema.json
git commit -m "feat(payload): index a bundle's schema fields (DROPSH-17)"
```

---

### Task 2: Field argument parser

Turns the token stream Commander hands through for unknown options into an ordered parameter list. Knows nothing about schemas: it decides syntax, not meaning.

**Files:**
- Create: `src/core/params/parse-args.ts`
- Test: `tests/unit/core/params/parse-args.test.ts`

**Interfaces:**
- Consumes: `ValidationError` from `src/errors.ts`.
- Produces:
  ```ts
  export interface RawParameter {
    path: string;
    value: string;
    form: "flag" | "set" | "json";
    hasValue: boolean;
  }
  export function parseFieldArgs(tokens: string[]): RawParameter[];
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/params/parse-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFieldArgs } from "../../../../src/core/params/parse-args.js";
import { ValidationError } from "../../../../src/errors.js";

describe("parseFieldArgs", () => {
  it("returns an empty list for no tokens", () => {
    expect(parseFieldArgs([])).toEqual([]);
  });

  it("reads --field value pairs in argv order", () => {
    expect(parseFieldArgs(["--title", "Test", "--body.value", "Text"])).toEqual([
      { path: "title", value: "Test", form: "flag", hasValue: true },
      { path: "body.value", value: "Text", form: "flag", hasValue: true },
    ]);
  });

  it("reads the --field=value form", () => {
    expect(parseFieldArgs(["--title=Hello World"])).toEqual([
      { path: "title", value: "Hello World", form: "flag", hasValue: true },
    ]);
  });

  it("keeps a value that starts with -- when given via =", () => {
    expect(parseFieldArgs(["--title=--weird"])).toEqual([
      { path: "title", value: "--weird", form: "flag", hasValue: true },
    ]);
  });

  it("marks a bare flag as having no value", () => {
    expect(parseFieldArgs(["--status", "--title", "T"])).toEqual([
      { path: "status", value: "", form: "flag", hasValue: false },
      { path: "title", value: "T", form: "flag", hasValue: true },
    ]);
  });

  it("never comma-splits a value", () => {
    expect(parseFieldArgs(["--title", "a, b"])).toEqual([
      { path: "title", value: "a, b", form: "flag", hasValue: true },
    ]);
  });

  it("expands --set variadically until the next option", () => {
    expect(parseFieldArgs(["--set", "title=T", "body.value=X", "--status", "true"])).toEqual([
      { path: "title", value: "T", form: "set", hasValue: true },
      { path: "body.value", value: "X", form: "set", hasValue: true },
      { path: "status", value: "true", form: "flag", hasValue: true },
    ]);
  });

  it("keeps everything after the first = in a --set pair", () => {
    expect(parseFieldArgs(["--set", "title=a=b"])).toEqual([
      { path: "title", value: "a=b", form: "set", hasValue: true },
    ]);
  });

  it("reads --json as a raw JSON value", () => {
    expect(parseFieldArgs(["--json", 'links=[{"uri":"https://x"}]'])).toEqual([
      { path: "links", value: '[{"uri":"https://x"}]', form: "json", hasValue: true },
    ]);
  });

  it("repeats a path when the flag repeats", () => {
    expect(parseFieldArgs(["--field_tags", "u1", "--field_tags", "u2"])).toEqual([
      { path: "field_tags", value: "u1", form: "flag", hasValue: true },
      { path: "field_tags", value: "u2", form: "flag", hasValue: true },
    ]);
  });

  it("rejects a positional in the field region", () => {
    expect(() => parseFieldArgs(["oops"])).toThrow(ValidationError);
    expect(() => parseFieldArgs(["oops"])).toThrow(/unexpected argument "oops"/);
  });

  it("rejects a --set pair without =", () => {
    expect(() => parseFieldArgs(["--set", "title"])).toThrow(/--set expects <field>=<value>/);
  });

  it("rejects --set with no pair at all", () => {
    expect(() => parseFieldArgs(["--set", "--title", "T"])).toThrow(
      /--set expects at least one <field>=<value>/,
    );
  });

  it("rejects a bare --", () => {
    expect(() => parseFieldArgs(["--"])).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/core/params/parse-args.test.ts`
Expected: FAIL — cannot resolve `src/core/params/parse-args.js`.

- [ ] **Step 3: Implement the parser**

Create `src/core/params/parse-args.ts`:

```ts
import { ValidationError } from "../../errors.js";

export interface RawParameter {
  /** Dotted path into the payload, e.g. "title" or "body.value". */
  path: string;
  value: string;
  /** Which surface syntax produced it; "json" means `value` is raw JSON. */
  form: "flag" | "set" | "json";
  /**
   * False for a bare `--field` with no following value. Whether that is legal
   * depends on the field's schema type, so the decision belongs to the builder.
   */
  hasValue: boolean;
}

/** `--set` and `--json` are the two collectors; a field of the same name is
 *  reachable only through them (`--set set=…`). */
const COLLECTORS = new Set(["set", "json"]);

function splitPair(pair: string, collector: string): { path: string; value: string } {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    throw new ValidationError(`--${collector} expects <field>=<value> pairs, got "${pair}"`);
  }
  return { path: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

/**
 * Parse the token stream Commander passes through for unknown options into an
 * ordered parameter list. Purely syntactic: no schema is consulted, so an
 * unknown field name is not an error here.
 */
export function parseFieldArgs(tokens: string[]): RawParameter[] {
  const out: RawParameter[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (!token.startsWith("--")) {
      throw new ValidationError(
        `unexpected argument "${token}"; field parameters are long options (--<field> <value>)`,
      );
    }
    const body = token.slice(2);
    if (body.length === 0) {
      throw new ValidationError('"--" is not a field parameter');
    }
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);

    if (COLLECTORS.has(name)) {
      const form = name === "set" ? "set" : "json";
      const pairs: string[] = [];
      if (eq !== -1) {
        pairs.push(body.slice(eq + 1));
        i += 1;
      } else {
        i += 1;
        while (i < tokens.length && !(tokens[i] as string).startsWith("--")) {
          pairs.push(tokens[i] as string);
          i += 1;
        }
      }
      if (pairs.length === 0) {
        throw new ValidationError(`--${name} expects at least one <field>=<value> pair`);
      }
      for (const pair of pairs) {
        const { path, value } = splitPair(pair, name);
        out.push({ path, value, form, hasValue: true });
      }
      continue;
    }

    if (eq !== -1) {
      out.push({ path: name, value: body.slice(eq + 1), form: "flag", hasValue: true });
      i += 1;
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out.push({ path: name, value: next, form: "flag", hasValue: true });
      i += 2;
      continue;
    }
    out.push({ path: name, value: "", form: "flag", hasValue: false });
    i += 1;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/core/params/parse-args.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/core/params/parse-args.ts tests/unit/core/params/parse-args.test.ts
git commit -m "feat(params): parse free-form field arguments (DROPSH-17)"
```

---

### Task 3: Payload builder — attributes

Turns the parameter list into `data.attributes`, resolving dotted paths against the field's subschema, coercing values by their leaf type, rejecting unknown names, and emitting keys in canonical order. Relationships come in Task 4.

**Files:**
- Create: `src/core/payload/from-parameters.ts`
- Test: `tests/unit/core/payload/from-parameters.test.ts`

**Interfaces:**
- Consumes: `indexSchemaFields`, `propertiesOf`, `FieldDescriptor` from Task 1; `RawParameter` from Task 2; `ValidationError`.
- Produces:
  ```ts
  export interface BuildPayloadInput {
    schema: unknown;
    parameters: RawParameter[];
    operation: "create" | "update";
    id?: string;
    resourceType?: string;
  }
  export function buildPayloadFromParameters(input: BuildPayloadInput): unknown;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/payload/from-parameters.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFieldArgs } from "../../../../src/core/params/parse-args.js";
import { buildPayloadFromParameters } from "../../../../src/core/payload/from-parameters.js";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";
import { ValidationError } from "../../../../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "../../fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;
const createSchema = toOperationVariant(RAW, "create");

function build(argv: string[]): unknown {
  return buildPayloadFromParameters({
    schema: createSchema,
    parameters: parseFieldArgs(argv),
    operation: "create",
  });
}

describe("buildPayloadFromParameters — attributes", () => {
  it("AC 1: places a scalar and a nested sub-property under attributes", () => {
    expect(build(["--title", "Test", "--body.value", "Text"])).toEqual({
      data: {
        type: "node--article",
        attributes: { title: "Test", body: { value: "Text" } },
      },
    });
  });

  it("merges several sub-properties of one field", () => {
    expect(build(["--body.value", "Text", "--body.format", "basic_html"])).toEqual({
      data: {
        type: "node--article",
        attributes: { body: { value: "Text", format: "basic_html" } },
      },
    });
  });

  it("coerces a boolean and an integer by their schema type", () => {
    expect(build(["--status", "true", "--weight", "17"])).toEqual({
      data: { type: "node--article", attributes: { status: true, weight: 17 } },
    });
  });

  it("treats a bare flag on a boolean field as true", () => {
    expect(build(["--status"])).toEqual({
      data: { type: "node--article", attributes: { status: true } },
    });
  });

  it("keeps a string value verbatim, including commas", () => {
    expect(build(["--title", "a, b"])).toEqual({
      data: { type: "node--article", attributes: { title: "a, b" } },
    });
  });

  it("AC 2: --set is byte-identical to the per-field form", () => {
    const viaSet = build(["--set", "title=T", "body.value=X", "weight=3"]);
    const viaFlags = build(["--title", "T", "--body.value", "X", "--weight", "3"]);
    expect(JSON.stringify(viaSet)).toBe(JSON.stringify(viaFlags));
  });

  it("emits keys in schema order regardless of flag order", () => {
    const a = build(["--title", "T", "--weight", "3", "--status", "true"]);
    const b = build(["--status", "true", "--weight", "3", "--title", "T"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys((a as { data: { attributes: object } }).data.attributes)).toEqual([
      "title",
      "status",
      "weight",
    ]);
  });

  it("orders sub-properties by the field's own subschema", () => {
    const built = build(["--body.format", "basic_html", "--body.value", "X"]);
    const body = (built as { data: { attributes: { body: object } } }).data.attributes.body;
    expect(Object.keys(body)).toEqual(["value", "format"]);
  });

  it("AC 3: rejects an unknown parameter, naming it and the known fields", () => {
    expect(() => build(["--titel", "T"])).toThrow(ValidationError);
    expect(() => build(["--titel", "T"])).toThrow(/unknown parameter 'titel'/);
    expect(() => build(["--titel", "T"])).toThrow(/title/);
    expect(() => build(["--titel", "T"])).toThrow(/field_tags/);
  });

  it("rejects an unknown sub-property of a known field", () => {
    expect(() => build(["--body.wert", "X"])).toThrow(/unknown sub-property 'wert' of 'body'/);
  });

  it("rejects a missing value on a non-boolean field", () => {
    expect(() => build(["--title"])).toThrow(/missing value for --title/);
  });

  it("rejects a non-numeric value on an integer field", () => {
    expect(() => build(["--weight", "abc"])).toThrow(/--weight expects integer, got "abc"/);
  });

  it("rejects a fractional value on an integer field", () => {
    expect(() => build(["--weight", "1.5"])).toThrow(/expects integer/);
  });

  it("rejects a non-boolean value on a boolean field", () => {
    expect(() => build(["--status", "yes"])).toThrow(/--status expects true or false/);
  });

  it("rejects the same single-valued path given twice", () => {
    expect(() => build(["--title", "A", "--title", "B"])).toThrow(
      /parameter 'title' was given more than once/,
    );
  });

  it("omits attributes entirely when no attribute parameter is given", () => {
    expect(build([])).toEqual({ data: { type: "node--article" } });
  });

  it("falls back to the caller's resourceType when the schema has no type const", () => {
    const built = buildPayloadFromParameters({
      schema: { properties: { data: { properties: { attributes: { properties: { title: { type: "string" } } } } } } },
      parameters: parseFieldArgs(["--title", "T"]),
      operation: "create",
      resourceType: "node--page",
    });
    expect(built).toEqual({ data: { type: "node--page", attributes: { title: "T" } } });
  });

  it("errors when neither the schema nor the caller supplies a resource type", () => {
    expect(() =>
      buildPayloadFromParameters({
        schema: { properties: { data: { properties: { attributes: { properties: {} } } } } },
        parameters: [],
        operation: "create",
      }),
    ).toThrow(/cannot determine the JSON:API resource type/);
  });

  it("AC 8: update emits data.id and only the supplied fields", () => {
    const built = buildPayloadFromParameters({
      schema: toOperationVariant(RAW, "update"),
      parameters: parseFieldArgs(["--title", "New"]),
      operation: "update",
      id: "11111111-2222-3333-4444-555555555555",
    });
    expect(built).toEqual({
      data: {
        type: "node--article",
        id: "11111111-2222-3333-4444-555555555555",
        attributes: { title: "New" },
      },
    });
  });

  it("requires an id for update", () => {
    expect(() =>
      buildPayloadFromParameters({
        schema: toOperationVariant(RAW, "update"),
        parameters: parseFieldArgs(["--title", "New"]),
        operation: "update",
      }),
    ).toThrow(/update requires the entity id/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/core/payload/from-parameters.test.ts`
Expected: FAIL — cannot resolve `src/core/payload/from-parameters.js`.

- [ ] **Step 3: Implement the builder's attribute path**

Create `src/core/payload/from-parameters.ts`:

```ts
import { ValidationError } from "../../errors.js";
import type { RawParameter } from "../params/parse-args.js";
import {
  type FieldDescriptor,
  indexSchemaFields,
  propertiesOf,
  type SchemaFieldIndex,
} from "./schema-fields.js";

export interface BuildPayloadInput {
  /** The resolved operation schema, plugin extensions already applied. */
  schema: unknown;
  parameters: RawParameter[];
  operation: "create" | "update";
  /** Required for `update`: becomes `data.id`. */
  id?: string;
  /** Fallback resource type when the schema carries no `type` const/enum. */
  resourceType?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaTypeOf(node: unknown): string | undefined {
  if (!isRecord(node)) return undefined;
  const t = node.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.find((x): x is string => typeof x === "string" && x !== "null");
  return undefined;
}

/**
 * Convert one command-line string into the value the leaf schema node asks for.
 * A non-convertible value is rejected here rather than left for Ajv, because
 * `--no-validate` must not turn a wrong type into a silently wrong payload.
 */
function coerce(node: unknown, param: RawParameter, label: string): unknown {
  const type = schemaTypeOf(node);
  if (!param.hasValue) {
    if (type === "boolean") return true;
    throw new ValidationError(
      `missing value for --${label}${type !== undefined ? ` (expected ${type})` : ""}`,
    );
  }
  if (type === "boolean") {
    if (param.value === "true") return true;
    if (param.value === "false") return false;
    throw new ValidationError(`--${label} expects true or false, got "${param.value}"`);
  }
  if (type === "integer" || type === "number") {
    const n = Number(param.value);
    if (param.value.trim() === "" || !Number.isFinite(n)) {
      throw new ValidationError(`--${label} expects ${type}, got "${param.value}"`);
    }
    if (type === "integer" && !Number.isInteger(n)) {
      throw new ValidationError(`--${label} expects integer, got "${param.value}"`);
    }
    return n;
  }
  return param.value;
}

function parseJsonValue(param: RawParameter): unknown {
  try {
    return JSON.parse(param.value) as unknown;
  } catch (err) {
    throw new ValidationError(
      `--json ${param.path} is not valid JSON: ${(err as Error).message}`,
    );
  }
}

/** Re-emit an object with its keys in the order its subschema declares them,
 *  so the same fields always serialise to the same bytes. */
function ordered(node: unknown, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = isRecord(node) ? node.items : undefined;
    return value.map((entry) => ordered(items, entry));
  }
  if (!isRecord(value)) return value;
  const props = propertiesOf(node);
  const keys = Object.keys(value);
  const declared = props ? Object.keys(props).filter((k) => keys.includes(k)) : [];
  const extra = keys.filter((k) => !declared.includes(k)).sort();
  const out: Record<string, unknown> = {};
  for (const key of [...declared, ...extra]) {
    out[key] = ordered(props?.[key], value[key]);
  }
  return out;
}

/** Walk a dotted path into a field's subschema, rejecting a segment the schema
 *  does not declare. Returns the leaf node the value must satisfy. */
function resolveLeaf(field: FieldDescriptor, segments: string[]): unknown {
  let node = field.node;
  for (const segment of segments) {
    const props = propertiesOf(node);
    const next = props?.[segment];
    if (next === undefined) {
      throw new ValidationError(
        `unknown sub-property '${segment}' of '${field.name}'${
          props ? `; known: ${Object.keys(props).join(", ")}` : ""
        }`,
      );
    }
    node = next;
  }
  return node;
}

function assign(
  target: Record<string, unknown>,
  segments: string[],
  value: unknown,
  label: string,
): void {
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
    } else if (isRecord(existing)) {
      cursor = existing;
    } else {
      throw new ValidationError(`parameter '${label}' conflicts with an earlier value`);
    }
  }
  const leaf = segments[segments.length - 1] as string;
  if (leaf in cursor) {
    throw new ValidationError(`parameter '${label}' was given more than once`);
  }
  cursor[leaf] = value;
}

function unknownParameter(name: string, index: SchemaFieldIndex): never {
  const attributes: string[] = [];
  const relationships: string[] = [];
  for (const field of index.fields.values()) {
    (field.kind === "attribute" ? attributes : relationships).push(field.name);
  }
  throw new ValidationError(
    `unknown parameter '${name}'. Known attributes: ${attributes.join(", ") || "(none)"}. ` +
      `Known relationships: ${relationships.join(", ") || "(none)"}. ` +
      "A field whose name is a reserved option is reachable as --set <field>=<value>.",
  );
}

export function buildPayloadFromParameters(input: BuildPayloadInput): unknown {
  const index = indexSchemaFields(input.schema);
  const attributes: Record<string, unknown> = {};

  for (const param of input.parameters) {
    const segments = param.path.split(".");
    const name = segments[0] as string;
    const field = index.fields.get(name);
    if (!field) unknownParameter(name, index);
    if (field.kind === "relationship") {
      throw new ValidationError(`relationship '${name}' is not supported yet`);
    }
    const tail = segments.slice(1);
    const leaf = resolveLeaf(field, tail);
    const value =
      param.form === "json" ? ordered(leaf, parseJsonValue(param)) : coerce(leaf, param, param.path);
    assign(attributes, segments, value, param.path);
  }

  const resourceType = index.resourceType ?? input.resourceType;
  if (resourceType === undefined) {
    throw new ValidationError(
      "cannot determine the JSON:API resource type: the schema declares no type and no fallback was given",
    );
  }

  const data: Record<string, unknown> = { type: resourceType };
  if (input.operation === "update") {
    if (input.id === undefined || input.id === "") {
      throw new ValidationError("update requires the entity id for data.id");
    }
    data.id = input.id;
  }
  const attributeNode = propertiesOf(propertiesOf(input.schema)?.data)?.attributes;
  if (Object.keys(attributes).length > 0) {
    data.attributes = ordered(attributeNode, attributes);
  }
  return { data };
}
```

Ordering note: `ordered()` reorders each field's sub-object, and the top-level
`attributes` object is reordered by the same call because the attributes node's
`properties` map is the schema declaration order.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/core/payload/from-parameters.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/core/payload/from-parameters.ts tests/unit/core/payload/from-parameters.test.ts
git commit -m "feat(payload): build attributes from named parameters (DROPSH-17)"
```

---

### Task 4: Payload builder — relationships and the JSON escape

Adds `data.relationships` from bare UUIDs, single- and multi-valued, and lets `--json` write an array-of-object attribute.

**Files:**
- Modify: `src/core/payload/from-parameters.ts`
- Test: `tests/unit/core/payload/from-parameters.test.ts` (append a second `describe`)

**Interfaces:**
- Consumes: `FieldDescriptor.targetTypes` and `FieldDescriptor.multiple` from Task 1.
- Produces: no new exports; `buildPayloadFromParameters` gains relationship support.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/core/payload/from-parameters.test.ts`:

```ts
describe("buildPayloadFromParameters — relationships", () => {
  const UUID = "123e4567-e89b-12d3-a456-426614174000";
  const OTHER = "223e4567-e89b-12d3-a456-426614174001";

  it("AC 4: builds a single relationship from a bare UUID", () => {
    expect(build(["--uid", UUID])).toEqual({
      data: {
        type: "node--article",
        relationships: { uid: { data: { type: "user--user", id: UUID } } },
      },
    });
  });

  it("accumulates a multi-valued relationship over repeated flags", () => {
    expect(build(["--field_tags", UUID, "--field_tags", OTHER])).toEqual({
      data: {
        type: "node--article",
        relationships: {
          field_tags: {
            data: [
              { type: "taxonomy_term--tags", id: UUID },
              { type: "taxonomy_term--tags", id: OTHER },
            ],
          },
        },
      },
    });
  });

  it("rejects a second value on a single-valued relationship", () => {
    expect(() => build(["--uid", UUID, "--uid", OTHER])).toThrow(
      /relationship 'uid' accepts a single value/,
    );
  });

  it("requires <type>:<uuid> when the schema allows several target types", () => {
    expect(() => build(["--field_ref", UUID])).toThrow(/allows several target types/);
    expect(() => build(["--field_ref", UUID])).toThrow(/node--article, node--page/);
  });

  it("accepts the explicit <type>:<uuid> form", () => {
    expect(build(["--field_ref", `node--page:${UUID}`])).toEqual({
      data: {
        type: "node--article",
        relationships: { field_ref: { data: { type: "node--page", id: UUID } } },
      },
    });
  });

  it("rejects an explicit type the schema does not allow", () => {
    expect(() => build(["--uid", `node--page:${UUID}`])).toThrow(
      /'node--page' is not an allowed target type for 'uid'/,
    );
  });

  it("rejects a sub-path on a relationship", () => {
    expect(() => build(["--uid.data.id", UUID])).toThrow(
      /relationship 'uid' takes a UUID, not a sub-path/,
    );
  });

  it("rejects a relationship with no value", () => {
    expect(() => build(["--uid"])).toThrow(/missing value for --uid/);
  });

  it("orders relationships after attributes and in schema order", () => {
    const built = build(["--field_tags", UUID, "--title", "T", "--uid", OTHER]);
    expect(Object.keys(built as Record<string, unknown>)).toEqual(["data"]);
    const data = (built as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toEqual(["type", "attributes", "relationships"]);
    expect(Object.keys(data.relationships as object)).toEqual(["uid", "field_tags"]);
  });

  it("writes an array-of-object attribute through --json", () => {
    expect(build(["--json", 'links=[{"uri":"https://x","title":"X"}]'])).toEqual({
      data: {
        type: "node--article",
        attributes: { links: [{ uri: "https://x", title: "X" }] },
      },
    });
  });

  it("orders keys inside a --json array by the item subschema", () => {
    const built = build(["--json", 'links=[{"title":"X","uri":"https://x"}]']);
    const links = (built as { data: { attributes: { links: object[] } } }).data.attributes.links;
    expect(Object.keys(links[0] as object)).toEqual(["uri", "title"]);
  });

  it("rejects invalid JSON", () => {
    expect(() => build(["--json", "links=[{"])).toThrow(/--json links is not valid JSON/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/core/payload/from-parameters.test.ts`
Expected: FAIL — the relationship cases hit `relationship 'uid' is not supported yet`.

- [ ] **Step 3: Implement relationship building**

In `src/core/payload/from-parameters.ts`, add above `buildPayloadFromParameters`:

```ts
interface ResourceIdentifier {
  type: string;
  id: string;
}

/**
 * A relationship parameter is a bare UUID whenever the schema allows exactly one
 * target type, and `<type>:<uuid>` when it allows several. The UUID itself never
 * contains a colon, so the split is unambiguous.
 */
function resourceIdentifier(field: FieldDescriptor, param: RawParameter): ResourceIdentifier {
  if (!param.hasValue) {
    throw new ValidationError(`missing value for --${field.name} (expected a UUID)`);
  }
  const allowed = field.targetTypes ?? [];
  const colon = param.value.lastIndexOf(":");
  if (colon > 0) {
    const type = param.value.slice(0, colon);
    const id = param.value.slice(colon + 1);
    if (allowed.length > 0 && !allowed.includes(type)) {
      throw new ValidationError(
        `'${type}' is not an allowed target type for '${field.name}'; allowed: ${allowed.join(", ")}`,
      );
    }
    return { type, id };
  }
  if (allowed.length === 0) {
    throw new ValidationError(
      `relationship '${field.name}' declares no target type in the schema; pass <type>:<uuid>`,
    );
  }
  if (allowed.length > 1) {
    throw new ValidationError(
      `relationship '${field.name}' allows several target types (${allowed.join(", ")}); ` +
        `pass <type>:<uuid>`,
    );
  }
  return { type: allowed[0] as string, id: param.value };
}
```

Then replace the relationship branch of the parameter loop and extend the
assembly. The loop body becomes:

```ts
  const relationships = new Map<string, ResourceIdentifier[]>();

  for (const param of input.parameters) {
    const segments = param.path.split(".");
    const name = segments[0] as string;
    const field = index.fields.get(name);
    if (!field) unknownParameter(name, index);

    if (field.kind === "relationship") {
      if (segments.length > 1) {
        throw new ValidationError(
          `relationship '${name}' takes a UUID, not a sub-path ('${param.path}')`,
        );
      }
      const collected = relationships.get(name) ?? [];
      if (collected.length > 0 && field.multiple !== true) {
        throw new ValidationError(
          `relationship '${name}' accepts a single value; it was given more than once`,
        );
      }
      collected.push(resourceIdentifier(field, param));
      relationships.set(name, collected);
      continue;
    }

    const tail = segments.slice(1);
    const leaf = resolveLeaf(field, tail);
    const value = param.form === "json" ? parseJsonValue(param) : coerce(leaf, param, param.path);
    assign(attributes, segments, param.form === "json" ? ordered(leaf, value) : value, param.path);
  }
```

and after the `data.attributes` assignment:

```ts
  if (relationships.size > 0) {
    const out: Record<string, unknown> = {};
    for (const name of index.order) {
      const collected = relationships.get(name);
      if (!collected) continue;
      const field = index.fields.get(name) as FieldDescriptor;
      out[name] = { data: field.multiple === true ? collected : (collected[0] as ResourceIdentifier) };
    }
    data.relationships = out;
  }
```

Delete the temporary `relationship '…' is not supported yet` throw from Task 3.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/core/payload/from-parameters.test.ts`
Expected: PASS, 31 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/core/payload/from-parameters.ts tests/unit/core/payload/from-parameters.test.ts
git commit -m "feat(payload): relationships from bare UUIDs and a --json escape (DROPSH-17)"
```

---

### Task 5: Public plugin API

Makes the builder reachable by a plugin without the CLI (AC 7).

**Files:**
- Modify: `src/plugin-api.ts`
- Test: `tests/unit/plugin-api-payload.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `buildPayloadFromParameters`, `indexSchemaFields`, `propertiesOf` and the types `BuildPayloadInput`, `FieldDescriptor`, `SchemaFieldIndex`, `RawParameter` from `dropsh/plugin`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plugin-api-payload.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type BuildPayloadInput,
  buildPayloadFromParameters,
  type FieldDescriptor,
  indexSchemaFields,
  type RawParameter,
  type SchemaFieldIndex,
} from "../../src/plugin-api.js";
import { toOperationVariant } from "../../src/core/schema/to-jsonschema.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;

describe("AC 7: a plugin can build a payload without the CLI", () => {
  it("exports the builder and the index from dropsh/plugin", () => {
    const schema = toOperationVariant(RAW, "create");
    const index: SchemaFieldIndex = indexSchemaFields(schema);
    const title: FieldDescriptor | undefined = index.fields.get("title");
    expect(title?.kind).toBe("attribute");

    const parameters: RawParameter[] = [
      { path: "title", value: "From a plugin", form: "flag", hasValue: true },
      { path: "uid", value: "123e4567-e89b-12d3-a456-426614174000", form: "flag", hasValue: true },
    ];
    const input: BuildPayloadInput = { schema, parameters, operation: "create" };
    expect(buildPayloadFromParameters(input)).toEqual({
      data: {
        type: "node--article",
        attributes: { title: "From a plugin" },
        relationships: {
          uid: { data: { type: "user--user", id: "123e4567-e89b-12d3-a456-426614174000" } },
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/plugin-api-payload.test.ts`
Expected: FAIL — `buildPayloadFromParameters` is not exported from `src/plugin-api.ts`.

- [ ] **Step 3: Add the exports**

In `src/plugin-api.ts`, insert in alphabetical position among the existing
`export type` / `export` lines (after the `./core/jsonapi/types.js` block):

```ts
export type { RawParameter } from "./core/params/parse-args.js";
export type { BuildPayloadInput } from "./core/payload/from-parameters.js";
export { buildPayloadFromParameters } from "./core/payload/from-parameters.js";
export type { FieldDescriptor, SchemaFieldIndex } from "./core/payload/schema-fields.js";
export { indexSchemaFields, propertiesOf } from "./core/payload/schema-fields.js";
```

`RawParameter` is exported as a **type only**: a plugin needs to describe
parameters, not to parse a command line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/plugin-api-payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/plugin-api.ts tests/unit/plugin-api-payload.test.ts
git commit -m "feat(plugin): export the parameter payload builder (DROPSH-17)"
```

---

### Task 6: Wire `create`

`create` accepts field parameters; the built payload enters the existing validate → dry-run → POST path unchanged.

**Files:**
- Modify: `src/commands/create.ts:4-29`
- Modify: `src/index.ts:446-483`
- Test: `tests/unit/commands/create.test.ts`
- Test: `tests/unit/index.test.ts`

**Interfaces:**
- Consumes: `parseFieldArgs` (Task 2), `buildPayloadFromParameters` (Tasks 3–4), the existing `loadOrFetchSchema` (`src/index.ts:302`).
- Produces: `CreateArgs` gains `payload?: unknown` and `dataArg` becomes optional.

- [ ] **Step 1: Write the failing command test**

Append to `tests/unit/commands/create.test.ts`:

```ts
describe("runCreate with a pre-built payload", () => {
  it("POSTs the given payload without touching dataArg", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      {
        entityType: "node",
        bundle: "article",
        payload: { data: { type: "node--article", attributes: { title: "Built" } } },
      },
      { client: c, emit: (v) => { emitted.push(v); } },
    );
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Built" } },
    });
  });

  it("validates a pre-built payload like any other", async () => {
    const validate = vi.fn();
    const c = client();
    await runCreate(
      { entityType: "node", bundle: "article", payload: { data: { type: "node--article" } } },
      { client: c, emit: () => {}, validate },
    );
    expect(validate).toHaveBeenCalledWith({ data: { type: "node--article" } }, "node/article");
  });

  it("dry-runs a pre-built payload without posting", async () => {
    const c = client();
    const emitted: unknown[] = [];
    await runCreate(
      {
        entityType: "node",
        bundle: "article",
        payload: { data: { type: "node--article", attributes: { title: "Built" } } },
        dryRun: true,
      },
      { client: c, emit: (v) => { emitted.push(v); } },
    );
    expect(c.post).not.toHaveBeenCalled();
    expect(emitted).toEqual([{
      dry_run: true,
      method: "POST",
      path: "node/article",
      payload: { data: { type: "node--article", attributes: { title: "Built" } } },
    }]);
  });

  it("requires either a payload or dataArg", async () => {
    await expect(
      runCreate({ entityType: "node", bundle: "article" }, { client: client(), emit: () => {} }),
    ).rejects.toThrow(/either --data or field parameters/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/commands/create.test.ts`
Expected: FAIL — `payload` is not a property of `CreateArgs` (type error) and `dataArg` is required.

- [ ] **Step 3: Widen `runCreate`**

Replace the head of `src/commands/create.ts`:

```ts
import type { JsonApiClient } from "../core/jsonapi/client.js";
import { ValidationError } from "../errors.js";
import { readDataArg } from "./_data.js";

export interface CreateArgs {
  entityType: string;
  bundle: string;
  /** Raw `--data` argument (inline JSON or @path). Absent in parameter mode. */
  dataArg?: string;
  /** Document already built from field parameters. Absent in `--data` mode. */
  payload?: unknown;
  dryRun?: boolean;
  noValidate?: boolean;
}
```

and the first line of the body:

```ts
export async function runCreate(args: CreateArgs, deps: CreateDeps): Promise<void> {
  const payload =
    args.payload !== undefined
      ? args.payload
      : args.dataArg !== undefined
        ? await readDataArg(args.dataArg)
        : (() => {
            throw new ValidationError("provide either --data or field parameters (--<field> <value>)");
          })();
```

Everything below stays exactly as it is.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run tests/unit/commands/create.test.ts`
Expected: PASS — the four new tests plus the five existing ones.

- [ ] **Step 5: Write the failing CLI test**

Append to `tests/unit/index.test.ts`. `seedSchema` writes the resolved schema
into the on-disk cache the way `loadOrFetchSchema` reads it, so the test needs no
HTTP at all:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { dirname } from "node:path";
import { toOperationVariant } from "../../src/core/schema/to-jsonschema.js";

const here = dirname(fileURLToPath(import.meta.url));
const RICH_RAW = JSON.parse(
  readFileSync(
    join(here, "fixtures/schemata/node--article.rich.schema.json"),
    "utf8",
  ),
) as unknown;

/** Mirrors siteCacheRoot()/loadOrFetchSchema() for baseUrl "https://ex". */
function seedSchema(cwd: string, op: "create" | "update", hookPlugins: string[] = []): void {
  const abs = join(cwd, ".dropsh/cache", "ex", "schema", `node--article.${op}.json`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    JSON.stringify({
      ...(toOperationVariant(RICH_RAW, op) as Record<string, unknown>),
      "x-dropsh-schema-pipeline-version": 2,
      "x-dropsh-operation-hook-plugins": hookPlugins,
    }),
    "utf8",
  );
}

function paramContext(cwd: string, client: JsonApiClient, plugins: DropSHPlugin[] = []) {
  return {
    client,
    http: { send: vi.fn(async () => { throw new Error("no HTTP expected"); }) },
    auth: { apply: async (req: unknown) => req },
    baseUrl: "https://ex",
    jsonapiPrefix: "/jsonapi",
    cwd,
    plugins,
  } as unknown as CommandContext;
}

describe("create with field parameters", () => {
  it("AC 1: builds and POSTs a document from named parameters", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node", "dropsh", "create", "node",
      "--bundle", "article",
      "--title", "Test",
      "--body.value", "Text",
    ]);
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Test", body: { value: "Text" } } },
    });
  });

  it("AC 6: --dry-run prints the built document and sends nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    const out: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: (s) => out.push(s),
    });
    await p.parseAsync([
      "node", "dropsh", "create", "node", "--bundle", "article", "--title", "T", "--dry-run",
    ]);
    expect(c.post).not.toHaveBeenCalled();
    expect(c.patch).not.toHaveBeenCalled();
    expect(JSON.parse(out.join(""))).toEqual({
      dry_run: true,
      method: "POST",
      path: "node/article",
      payload: { data: { type: "node--article", attributes: { title: "T" } } },
    });
  });

  it("AC 3: exits 4 on an unknown parameter and sends nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    let code: number | undefined;
    const errs: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: () => {},
      stderr: (s) => errs.push(s),
      setExitCode: (n) => { code = n; },
    });
    await p.parseAsync([
      "node", "dropsh", "create", "node", "--bundle", "article", "--titel", "T",
    ]);
    expect(code).toBe(4);
    expect(errs.join("")).toMatch(/unknown parameter 'titel'/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("rejects --data together with field parameters", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    let code: number | undefined;
    const errs: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: () => {},
      stderr: (s) => errs.push(s),
      setExitCode: (n) => { code = n; },
    });
    await p.parseAsync([
      "node", "dropsh", "create", "node", "--bundle", "article",
      "--data", "{}", "--title", "T",
    ]);
    expect(code).toBe(4);
    expect(errs.join("")).toMatch(/mutually exclusive/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("AC 9: --data alone still sends the identical payload", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node", "dropsh", "create", "node", "--bundle", "article",
      "--no-validate",
      "--data", '{"data":{"type":"node--article","attributes":{"title":"Raw"}}}',
    ]);
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Raw" } },
    });
  });
});
```

Every case builds a fresh `buildProgram()`: Commander accumulates option state on
a reused `Command` instance across `parse` calls.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/index.test.ts`
Expected: FAIL — Commander errors with `unknown option '--title'`.

- [ ] **Step 7: Wire the command**

In `src/index.ts`, replace the `create` registration (currently lines 446–483):

```ts
  program
    .command("create <entity_type>")
    .description("Create an entity of given type/bundle")
    .requiredOption("--bundle <bundle>")
    .option("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .option("--no-validate", "skip client-side schema validation")
    .allowUnknownOption()
    .addHelpText("after", FIELD_PARAMETER_HELP)
    .action(
      (
        entityType: string,
        o: { bundle: string; data?: string; dryRun?: boolean; validate?: boolean },
        cmd: Command,
      ) => {
        const target = `${entityType}/${o.bundle}`;
        return run(async (ctx) => {
          const fields = parseFieldArgs(cmd.args.slice(1));
          if (o.data !== undefined && fields.length > 0) {
            throw new ValidationError(
              "--data and field parameters are mutually exclusive; use one or the other",
            );
          }
          const rctx: RenderContext = { command: "create", entityType, bundle: o.bundle };
          let cached: unknown;
          const schema = async () => (cached ??= await loadOrFetchSchema(ctx, target, "create"));

          const args: CreateArgs = { entityType, bundle: o.bundle };
          if (o.data !== undefined) args.dataArg = o.data;
          if (fields.length > 0) {
            args.payload = buildPayloadFromParameters({
              schema: await schema(),
              parameters: fields,
              operation: "create",
              resourceType: `${entityType}--${o.bundle}`,
            });
          }
          if (o.dryRun !== undefined) args.dryRun = o.dryRun;
          if (o.validate === false) args.noValidate = true;

          const deps: CreateDeps = { client: ctx.client, emit: (v) => output.emit(v, rctx) };
          if (!args.noValidate) {
            deps.validate = async (payload: unknown, t: string) =>
              validatePayload(await schema(), payload, t);
          }
          await runCreate(args, deps);
        }, assertRenderable);
      },
    );
```

Add the imports at the top of `src/index.ts`:

```ts
import { type CreateArgs, type CreateDeps, runCreate } from "./commands/create.js";
import { parseFieldArgs } from "./core/params/parse-args.js";
import { buildPayloadFromParameters } from "./core/payload/from-parameters.js";
import { ValidationError } from "./errors.js";
```

(`ValidationError` joins the existing `AuthError, ConfigError, exitCodeFor`
import from `./errors.js`; `runCreate`'s import gains the two types. `Command` is
already imported from `commander`.)

Add the shared help text above `buildProgram`:

```ts
const FIELD_PARAMETER_HELP = `
Field parameters (instead of --data):
  --<field> <value>          set a field, e.g. --title "Hello"
  --<field>.<sub> <value>    set a sub-property, e.g. --body.value "Text"
  --<relationship> <uuid>    reference by UUID; repeat for a multi-valued field
  --set <f>=<v> [<f>=<v>...] many fields in one flag
  --json <field>=<json>      raw JSON value, for arrays of objects

Field names come from the bundle's schema (see 'dropsh schema <entity>/<bundle>'),
so an unknown name is rejected instead of ignored. A field whose name collides
with a reserved option (--bundle, --data, --dry-run, --no-validate, --format,
--auth-profile, --config, --view-mode, --set, --json) is reachable only as
--set <field>=<value>. A value starting with -- needs the --<field>=<value> form.

Example:
  dropsh create node --bundle article --title "Hello" --body.value "Text" \\
    --uid 123e4567-e89b-12d3-a456-426614174000 --dry-run`;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/index.test.ts tests/unit/commands/create.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 9: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/index.ts src/commands/create.ts tests/unit/index.test.ts tests/unit/commands/create.test.ts
git commit -m "feat(create): build the payload from named field parameters (DROPSH-17)"
```

---

### Task 7: Wire `update`

Same treatment for PATCH, with `data.id` taken from the target UUID (AC 8).

**Files:**
- Modify: `src/commands/update.ts:5-35`
- Modify: `src/index.ts:485-518`
- Test: `tests/unit/commands/update.test.ts`
- Test: `tests/unit/index.test.ts`

**Interfaces:**
- Consumes: everything Task 6 consumes.
- Produces: `UpdateArgs` gains `payload?: unknown`; `dataArg` becomes optional.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/commands/update.test.ts`:

```ts
describe("runUpdate with a pre-built payload", () => {
  const target = "node/article/11111111-2222-3333-4444-555555555555";

  it("PATCHes the given payload", async () => {
    const c = client();
    await runUpdate(
      { target, payload: { data: { type: "node--article", id: "11111111-2222-3333-4444-555555555555", attributes: { title: "New" } } } },
      { client: c, emit: () => {} },
    );
    expect(c.patch).toHaveBeenCalledWith(target, {
      data: {
        type: "node--article",
        id: "11111111-2222-3333-4444-555555555555",
        attributes: { title: "New" },
      },
    });
  });

  it("requires either a payload or dataArg", async () => {
    await expect(
      runUpdate({ target }, { client: client(), emit: () => {} }),
    ).rejects.toThrow(/either --data or field parameters/);
  });
});
```

Append to `tests/unit/index.test.ts`:

```ts
describe("update with field parameters", () => {
  const uuid = "11111111-2222-3333-4444-555555555555";

  it("AC 8: builds a PATCH document with data.id and only the supplied fields", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "update");
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node", "dropsh", "update", `node/article/${uuid}`, "--title", "New title",
    ]);
    expect(c.patch).toHaveBeenCalledWith(`node/article/${uuid}`, {
      data: { type: "node--article", id: uuid, attributes: { title: "New title" } },
    });
  });

  it("AC 4: takes a relationship as a bare UUID on update", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "update");
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node", "dropsh", "update", `node/article/${uuid}`,
      "--uid", "123e4567-e89b-12d3-a456-426614174000",
    ]);
    expect(c.patch).toHaveBeenCalledWith(`node/article/${uuid}`, {
      data: {
        type: "node--article",
        id: uuid,
        relationships: {
          uid: { data: { type: "user--user", id: "123e4567-e89b-12d3-a456-426614174000" } },
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/commands/update.test.ts tests/unit/index.test.ts`
Expected: FAIL — `payload` is not on `UpdateArgs`; Commander errors with `unknown option '--title'`.

- [ ] **Step 3: Widen `runUpdate`**

In `src/commands/update.ts`, change the interface and the payload line:

```ts
export interface UpdateArgs {
  target: string;
  /** Raw `--data` argument (inline JSON or @path). Absent in parameter mode. */
  dataArg?: string;
  /** Document already built from field parameters. Absent in `--data` mode. */
  payload?: unknown;
  dryRun?: boolean;
  noValidate?: boolean;
}
```

```ts
  const payload =
    args.payload !== undefined
      ? args.payload
      : args.dataArg !== undefined
        ? await readDataArg(args.dataArg)
        : (() => {
            throw new ValidationError("provide either --data or field parameters (--<field> <value>)");
          })();
```

The `TARGET_RE` check stays first, ahead of everything else.

- [ ] **Step 4: Wire the command**

In `src/index.ts`, replace the `update` registration:

```ts
  program
    .command("update <target>")
    .description("Update an existing entity")
    .option("--data <json>", "inline JSON or @path")
    .option("--dry-run")
    .option("--no-validate", "skip client-side schema validation")
    .allowUnknownOption()
    .addHelpText("after", FIELD_PARAMETER_HELP)
    .action(
      (target: string, o: { data?: string; dryRun?: boolean; validate?: boolean }, cmd: Command) => {
        return run(async (ctx) => {
          const fields = parseFieldArgs(cmd.args.slice(1));
          if (o.data !== undefined && fields.length > 0) {
            throw new ValidationError(
              "--data and field parameters are mutually exclusive; use one or the other",
            );
          }
          const [entityType, bundle, id] = target.split("/") as [string?, string?, string?];
          const rctx: RenderContext = { command: "update", target };
          if (entityType !== undefined) rctx.entityType = entityType;
          if (bundle !== undefined) rctx.bundle = bundle;
          const schemaTarget = `${entityType}/${bundle}`;
          let cached: unknown;
          const schema = async () =>
            (cached ??= await loadOrFetchSchema(ctx, schemaTarget, "update"));

          const args: UpdateArgs = { target };
          if (o.data !== undefined) args.dataArg = o.data;
          if (fields.length > 0) {
            args.payload = buildPayloadFromParameters({
              schema: await schema(),
              parameters: fields,
              operation: "update",
              ...(id !== undefined ? { id } : {}),
              resourceType: `${entityType}--${bundle}`,
            });
          }
          if (o.dryRun !== undefined) args.dryRun = o.dryRun;
          if (o.validate === false) args.noValidate = true;

          const deps: UpdateDeps = { client: ctx.client, emit: (v) => output.emit(v, rctx) };
          if (!args.noValidate) {
            deps.validate = async (payload: unknown, t: string) =>
              validatePayload(await schema(), payload, t);
          }
          await runUpdate(args, deps);
        }, assertRenderable);
      },
    );
```

Extend the existing `runUpdate` import to
`import { type UpdateArgs, type UpdateDeps, runUpdate } from "./commands/update.js";`.

The `TARGET_RE` guard inside `runUpdate` still rejects a malformed target, but it
runs after the payload is built; move the guard to the top of `runUpdate` (it
already is) so a bad target is reported by `runUpdate` as today. When `target`
has fewer than three segments, `id` is `undefined` and the builder raises
`update requires the entity id for data.id` — check that this happens only for a
target `TARGET_RE` would reject anyway, and if the message is less clear than
`TARGET_RE`'s, validate the target in the action before building.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/commands/update.test.ts tests/unit/index.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 6: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add src/index.ts src/commands/update.ts tests/unit/index.test.ts tests/unit/commands/update.test.ts
git commit -m "feat(update): build PATCH documents from named field parameters (DROPSH-17)"
```

---

### Task 8: Plugin schema extensions (AC 5)

Proves that a field contributed only by a plugin's `extendOperationSchema` is accepted, and that a field no plugin contributed is still rejected.

**Files:**
- Test: `tests/unit/core/payload/plugin-extensions.test.ts`

**Interfaces:**
- Consumes: `applyOperationSchemaPlugins` (`src/commands/schema.ts:60`), `indexSchemaFields`, `buildPayloadFromParameters`, `DropSHPlugin`.
- Produces: nothing; this task is coverage only.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/payload/plugin-extensions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { applyOperationSchemaPlugins } from "../../../../src/commands/schema.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import type { HttpClient } from "../../../../src/core/http.js";
import { parseFieldArgs } from "../../../../src/core/params/parse-args.js";
import { buildPayloadFromParameters } from "../../../../src/core/payload/from-parameters.js";
import type { DropSHPlugin } from "../../../../src/core/plugin.js";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";
import { ValidationError } from "../../../../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "../../fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;

/** Adds one attribute the base schema does not declare. */
const extPlugin: DropSHPlugin = {
  id: "ext",
  requiredModules: [],
  extendOperationSchema: async (_entity, _bundle, _op, schema) => {
    const clone = JSON.parse(JSON.stringify(schema)) as Record<string, any>;
    clone.properties.data.properties.attributes.properties.field_plugin = { type: "string" };
    return clone;
  },
};

const http: HttpClient = { send: vi.fn() };
const auth: AuthAdapter = { apply: async (req) => req };

async function resolvedSchema(plugins: DropSHPlugin[]): Promise<unknown> {
  const { schema, extensions } = await applyOperationSchemaPlugins(
    toOperationVariant(RAW, "create"),
    { entity: "node", bundle: "article", operation: "create" },
    { http, auth, baseUrl: "https://ex", plugins },
  );
  expect(extensions).toEqual(plugins.filter((p) => p.extendOperationSchema).map((p) => p.id));
  return schema;
}

describe("AC 5: extendOperationSchema fields are usable as parameters", () => {
  it("accepts a field only the plugin contributed", async () => {
    const schema = await resolvedSchema([extPlugin]);
    expect(
      buildPayloadFromParameters({
        schema,
        parameters: parseFieldArgs(["--field_plugin", "from the plugin", "--title", "T"]),
        operation: "create",
      }),
    ).toEqual({
      data: {
        type: "node--article",
        attributes: { title: "T", field_plugin: "from the plugin" },
      },
    });
  });

  it("still rejects a field the plugin did not contribute", async () => {
    const schema = await resolvedSchema([extPlugin]);
    expect(() =>
      buildPayloadFromParameters({
        schema,
        parameters: parseFieldArgs(["--field_absent", "x"]),
        operation: "create",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects the plugin's field when the plugin is not registered", async () => {
    const schema = await resolvedSchema([]);
    expect(() =>
      buildPayloadFromParameters({
        schema,
        parameters: parseFieldArgs(["--field_plugin", "x"]),
        operation: "create",
      }),
    ).toThrow(/unknown parameter 'field_plugin'/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/unit/core/payload/plugin-extensions.test.ts`
Expected: PASS immediately — the builder reads whatever schema it is given, which
is the point being proved. If it fails, the builder is not schema-driven and
Tasks 3–4 need fixing.

- [ ] **Step 3: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add tests/unit/core/payload/plugin-extensions.test.ts
git commit -m "test(payload): plugin schema extensions are usable as parameters (DROPSH-17)"
```

---

### Task 9: Integration coverage against a live site

The only check that proves Drupal accepts the generated document, rather than proving Ajv does.

**Files:**
- Create: `tests/integrations/params/create-from-parameters.integration.test.ts`
- Create: `tests/integrations/params/update-from-parameters.integration.test.ts`

**Interfaces:**
- Consumes: the integration helpers under `tests/integrations/helpers/`.
- Produces: nothing.

Context for the implementer: `runCli({ site, args })` spawns the real CLI against
the live DDEV subsite and returns `{ code, stdout, stderr }`; `parseJson` /
`parseError` decode them. The `schemata` subsite carries the content type
`node/article_test` (`tests/integrations/drupal/fixtures/setup-content-type.php`)
with `title`, `body` (from `node_add_body_field`), `field_test_text` (string),
`field_image`, plus the base fields including the `uid` relationship. Do not add
a second bootstrap — use these helpers.

- [ ] **Step 1: Write the create test**

Create `tests/integrations/params/create-from-parameters.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseError, parseJson, runCli } from "../helpers/run.js";

interface Doc {
  data: { id: string; type: string; attributes: Record<string, unknown> };
}

describe("integration: create from field parameters", () => {
  it("AC 1: builds and POSTs a document from named parameters", async () => {
    const title = `params-create-${Date.now()}`;
    const created = await runCli({
      site: "schemata",
      args: [
        "create",
        "node",
        "--bundle=article_test",
        "--title",
        title,
        "--body.value",
        "Body from a parameter",
      ],
    });
    expect(created.code, created.stderr).toBe(0);
    const doc = parseJson<Doc>(created.stdout);
    expect(doc.data.type).toBe("node--article_test");
    expect(doc.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const read = await runCli({
      site: "schemata",
      args: ["read", `node/article_test/${doc.data.id}`],
    });
    expect(read.code, read.stderr).toBe(0);
    const back = parseJson<Doc>(read.stdout);
    expect(back.data.attributes.title).toBe(title);
    expect((back.data.attributes.body as { value: string }).value).toBe(
      "Body from a parameter",
    );
  });

  it("AC 3: an unknown parameter exits 4 and creates nothing", async () => {
    const title = `params-unknown-${Date.now()}`;
    const result = await runCli({
      site: "schemata",
      args: ["create", "node", "--bundle=article_test", "--titel", title],
    });
    expect(result.code).toBe(4);
    const errLine =
      result.stderr.split("\n").find((l) => l.includes("E_VALIDATION")) ?? result.stderr;
    expect(parseError(errLine).error.message).toMatch(/unknown parameter 'titel'/);

    const search = await runCli({
      site: "schemata",
      args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
    });
    expect(search.code, search.stderr).toBe(0);
    expect(parseJson<{ data: unknown[] }>(search.stdout).data).toHaveLength(0);
  });

  it("AC 6: --dry-run prints the built document and creates nothing", async () => {
    const title = `params-dry-${Date.now()}`;
    const result = await runCli({
      site: "schemata",
      args: ["create", "node", "--bundle=article_test", "--title", title, "--dry-run"],
    });
    expect(result.code, result.stderr).toBe(0);
    const out = parseJson<{ dry_run: boolean; method: string; payload: Doc }>(result.stdout);
    expect(out.dry_run).toBe(true);
    expect(out.method).toBe("POST");
    expect(out.payload.data.attributes.title).toBe(title);

    const search = await runCli({
      site: "schemata",
      args: ["search", "node", "--bundle=article_test", `--filter=title:${title}`],
    });
    expect(parseJson<{ data: unknown[] }>(search.stdout).data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the update test**

Create `tests/integrations/params/update-from-parameters.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

interface Doc {
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, { data?: { type: string; id: string } }>;
  };
}

async function createNode(title: string): Promise<Doc> {
  const created = await runCli({
    site: "schemata",
    args: [
      "create",
      "node",
      "--bundle=article_test",
      "--title",
      title,
      "--body.value",
      "original body",
    ],
  });
  expect(created.code, created.stderr).toBe(0);
  return parseJson<Doc>(created.stdout);
}

describe("integration: update from field parameters", () => {
  it("AC 8: PATCHes only the supplied field and leaves the rest intact", async () => {
    const doc = await createNode(`params-update-${Date.now()}`);
    const updated = await runCli({
      site: "schemata",
      args: ["update", `node/article_test/${doc.data.id}`, "--title", "changed title"],
    });
    expect(updated.code, updated.stderr).toBe(0);

    const read = await runCli({
      site: "schemata",
      args: ["read", `node/article_test/${doc.data.id}`],
    });
    const back = parseJson<Doc>(read.stdout);
    expect(back.data.attributes.title).toBe("changed title");
    expect((back.data.attributes.body as { value: string }).value).toBe("original body");
  });

  it("AC 4: sets a relationship from a bare UUID", async () => {
    const doc = await createNode(`params-rel-${Date.now()}`);
    const me = await runCli({ site: "schemata", args: ["read", "user/user/me"] });
    expect(me.code, me.stderr).toBe(0);
    const uid = parseJson<Doc>(me.stdout).data.id;

    const updated = await runCli({
      site: "schemata",
      args: ["update", `node/article_test/${doc.data.id}`, "--uid", uid],
    });
    expect(updated.code, updated.stderr).toBe(0);

    const read = await runCli({
      site: "schemata",
      args: ["read", `node/article_test/${doc.data.id}`],
    });
    const back = parseJson<Doc>(read.stdout);
    expect(back.data.relationships?.uid?.data?.id).toBe(uid);
    expect(back.data.relationships?.uid?.data?.type).toBe("user--user");
  });
});
```

If `read user/user/me` is not a supported target in this CLI, obtain the current
user's UUID through `client.me()`'s CLI equivalent or by searching
`user/user` — check `src/core/jsonapi/client.ts` and the existing auth
integration tests, and adjust that one line rather than the test's shape.

- [ ] **Step 3: Run the integration suite**

```bash
pnpm run drupal:up
pnpm run test:integration
```

Expected: PASS. Tear down with `pnpm run drupal:down` when finished.

- [ ] **Step 4: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add tests/integrations/params
git commit -m "test(integration): create and update from field parameters (DROPSH-17)"
```

---

### Task 10: Documentation

Brings `README.md` in line with the new surface. The CLI `--help` text shipped in Task 6.

**Files:**
- Modify: `README.md:290-308` (the `## Commands` block)

**Interfaces:**
- Consumes: the help text from Task 6, so the two cannot disagree.
- Produces: nothing.

- [ ] **Step 1: Update the command synopsis**

In the `## Commands` fenced block, replace the `create` and `update` lines so both
routes are visible:

```
dropsh create <entity_type> --bundle=<b> (--data=<json|@file> | <field parameters>) [--dry-run] [--no-validate]
dropsh update <entity_type>/<bundle>/<uuid> (--data=<json|@file> | <field parameters>) [--dry-run] [--no-validate]
```

- [ ] **Step 2: Add a "Field parameters" subsection**

Directly after the `## Commands` block, add a `### Field parameters on create / update`
section covering: the four forms (`--<field>`, `--<field>.<sub>`, `--set`,
`--json`), that names come from the bundle's schema so unknown names are rejected
with exit code 4, relationships from a bare UUID and the `<type>:<uuid>` form for
ambiguous targets, repetition for multi-valued relationships, that `--data` and
field parameters are mutually exclusive, that `--dry-run` prints the generated
document, that `--no-validate` skips Ajv but not the schema fetch, and the
reserved-option collision rule with `--set` as the escape. Include one worked
example with its exact JSON output, copied from the passing test in Task 6.

- [ ] **Step 3: Verify the documented example actually runs**

Run the example from Step 2 with `--dry-run` against the DDEV site (or against
the unit test's seeded schema) and paste the real output into the README. A
documented output that was never produced is a defect.

- [ ] **Step 4: Run the gate and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm test
git add README.md
git commit -m "docs: document field parameters on create and update (DROPSH-17)"
```

---

## Coverage against the acceptance criteria

| AC | Where it is proved |
|---|---|
| 1 Build and send from named parameters | Task 3 Step 1 (`AC 1: places a scalar and a nested sub-property`), Task 6 Step 5 (`AC 1: builds and POSTs`), Task 9 |
| 2 Many fields in one invocation | Task 3 Step 1 (`AC 2: --set is byte-identical`, `emits keys in schema order`) |
| 3 Unknown parameter is rejected | Task 3 Step 1 (`AC 3: rejects an unknown parameter`), Task 6 Step 5 (`AC 3: exits 4 … sends nothing`), Task 9 Step 2 |
| 4 Relationship from a bare UUID | Task 4 Step 1 (`AC 4: builds a single relationship`), Task 7 Step 1 (`AC 4: … on update`), Task 9 Step 3 |
| 5 Plugin schema extensions honoured | Task 8 (all three cases) |
| 6 Dry-run prints without sending | Task 6 Step 5 (`AC 6: --dry-run prints … and sends nothing`) |
| 7 Programmatic API | Task 5 (`AC 7: a plugin can build a payload without the CLI`) |
| 8 `update` builds PATCH the same way | Task 3 Step 1 (`AC 8: update emits data.id`), Task 7 Step 1 (`AC 8: builds a PATCH document`), Task 9 Step 3 |
| 9 Existing `--data` path unchanged | Task 6 Step 5 (`AC 9: --data alone still sends the identical payload`) plus the pre-existing suites, which must stay green at every commit |

---

## Amendments

Recorded during the second `coding` run, after the review of commit `9618a7e`
found work that had shipped outside these ten tasks. The task list above is left
as confirmed; the deltas are stated here. The corresponding design amendments
are in the spec's `## Amendments` section.

### A1 — `--set` dropped from Tasks 2, 3 and 10 (commit `3c8692c`)

The parser no longer treats `--set` as a collector, so its cases in Task 2 and
Task 3 became cases for the `--<field>=<value>` pair form instead, and Task 10's
README table lists three forms rather than four. The coverage row for AC 2 above
reads "Task 3 Step 1 (`AC 2: --set is byte-identical`)"; the test that carries it
is now named *"AC 2: the key=value list form is byte-identical to the spaced
form"* and asserts the same `JSON.stringify` equality. Rationale: design
amendment A1.

### A2 — an eleventh task, `--fields` (commits `75f5b98`, `892b8e1`, `8cf2533`, `9c6568e`)

Not in the ten tasks. `src/core/params/help.ts` (field listing + the `--help`
block) plus the `--fields` flag on `create`, `update` and `schema`, covered by
`tests/unit/core/params/help.test.ts`. Built the same way as every task above —
test-first, its own commits, the full gate green at each. Rationale: design
amendment A2.

### A3 — Task 10's worked example was not the produced output

Task 10 required "a worked example whose output was actually produced".
The `--fields` block that shipped in `README.md` showed 4 attributes and 2
relationships; the command actually prints 22 attributes and 4 relationships,
because Drupal's base fields are settable parameters too. Corrected in this run
against the live `schemata` subsite (`node/article_test`), and the dry-run
example now shows the `| jq` that produces its indented form — dropsh writes
compact JSON.
