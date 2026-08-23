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
