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
