import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toOperationVariant } from "../../src/core/schema/to-jsonschema.js";
import {
  type BuildPayloadInput,
  buildPayloadFromParameters,
  type FieldDescriptor,
  indexSchemaFields,
  type RawParameter,
  type SchemaFieldIndex,
} from "../../src/plugin-api.js";

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
