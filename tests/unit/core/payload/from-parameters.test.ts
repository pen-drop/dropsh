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
      schema: {
        properties: {
          data: { properties: { attributes: { properties: { title: { type: "string" } } } } },
        },
      },
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
