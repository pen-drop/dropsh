import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeFields,
  FIELD_PARAMETER_HELP,
  renderFieldsTable,
} from "../../../../src/core/params/help.js";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "../../fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;
const createSchema = toOperationVariant(RAW, "create");

describe("FIELD_PARAMETER_HELP", () => {
  it("documents the surface forms", () => {
    expect(FIELD_PARAMETER_HELP).toMatch(/--<field> <value>/);
    expect(FIELD_PARAMETER_HELP).toMatch(/--json <field>=<json>/);
  });

  it("points at --fields for the bundle's actual field names", () => {
    expect(FIELD_PARAMETER_HELP).toMatch(/--fields/);
  });

  it("names --fields among the reserved options", () => {
    expect(FIELD_PARAMETER_HELP).toMatch(/reserved option[\s\S]*--fields/);
  });
});

describe("describeFields", () => {
  const described = describeFields(createSchema);

  it("reports the resource type", () => {
    expect(described.type).toBe("node--article");
  });

  it("lists a scalar attribute with its parameter and schema type", () => {
    expect(described.attributes).toContainEqual({
      parameter: "--title <value>",
      path: "title",
      type: "string",
      label: "Title",
      required: true,
    });
  });

  it("expands an object attribute into its dotted sub-paths", () => {
    const paths = described.attributes.map((a) => a.path);
    expect(paths).toContain("body.value");
    expect(paths).toContain("body.format");
    expect(paths).toContain("body.summary");
    expect(paths).not.toContain("body");
  });

  it("marks a boolean attribute as usable as a bare flag", () => {
    expect(described.attributes).toContainEqual({
      parameter: "--status [true|false]",
      path: "status",
      type: "boolean",
      label: "Published",
      bare_flag: true,
    });
  });

  it("tells an array attribute to use --json", () => {
    const links = described.attributes.find((a) => a.path === "links");
    expect(links).toEqual({
      parameter: "--json links=<json>",
      path: "links",
      type: "array",
      label: "Links",
    });
  });

  it("keeps attributes in schema declaration order", () => {
    expect(described.attributes.map((a) => a.path).slice(0, 3)).toEqual([
      "title",
      "status",
      "weight",
    ]);
  });

  it("describes a single-valued relationship", () => {
    expect(described.relationships).toContainEqual({
      parameter: "--uid <uuid>",
      path: "uid",
      targets: ["user--user"],
      multiple: false,
      label: "Authored by",
    });
  });

  it("marks a multi-valued relationship", () => {
    const tags = described.relationships.find((r) => r.path === "field_tags");
    expect(tags?.multiple).toBe(true);
    expect(tags?.targets).toEqual(["taxonomy_term--tags"]);
  });

  it("requires the <type>:<uuid> form for an ambiguous relationship", () => {
    expect(described.relationships).toContainEqual({
      parameter: "--field_ref <type>:<uuid>",
      path: "field_ref",
      targets: ["node--article", "node--page"],
      multiple: false,
      label: "Reference",
      requires_type_prefix: true,
    });
  });

  it("returns empty lists for a schema that declares no fields", () => {
    const empty = describeFields({ type: "object" });
    expect(empty.attributes).toEqual([]);
    expect(empty.relationships).toEqual([]);
    expect(empty.type).toBeUndefined();
  });
});

describe("describeFields — labels and required", () => {
  it("carries a field's human label from the schema title", () => {
    const withLabel = describeFields({
      properties: {
        data: {
          properties: {
            type: { const: "node--x" },
            attributes: {
              properties: {
                body: {
                  type: "object",
                  title: "Body",
                  properties: { value: { type: "string", title: "Text" } },
                },
              },
            },
          },
        },
      },
    });
    expect(withLabel.attributes[0]).toEqual({
      parameter: "--body.value <value>",
      path: "body.value",
      type: "string",
      label: "Text",
    });
  });

  it("marks a required attribute", () => {
    const d = describeFields({
      properties: {
        data: {
          properties: {
            type: { const: "node--x" },
            attributes: {
              required: ["title"],
              properties: { title: { type: "string" }, other: { type: "string" } },
            },
          },
        },
      },
    });
    expect(d.attributes.find((a) => a.path === "title")?.required).toBe(true);
    expect(d.attributes.find((a) => a.path === "other")?.required).toBeUndefined();
  });
});

describe("renderFieldsTable", () => {
  const table = renderFieldsTable(describeFields(createSchema));

  it("heads the table with the resource type", () => {
    expect(table).toMatch(/node--article/);
  });

  it("lists each parameter on its own line", () => {
    expect(table).toMatch(/--title <value>/);
    expect(table).toMatch(/--body\.value <value>/);
    expect(table).toMatch(/--uid <uuid>/);
  });

  it("shows a boolean as a bare-able flag", () => {
    expect(table).toMatch(/--status \[true\|false\]/);
  });

  it("marks the required attribute", () => {
    expect(table).toMatch(/--title <value>.*required/);
  });

  it("names a relationship's target type", () => {
    expect(table).toMatch(/--uid <uuid>\s+user--user/);
  });

  it("marks a repeatable relationship", () => {
    expect(table).toMatch(/--field_tags .*repeatable/);
  });

  it("keeps hints in one aligned column", () => {
    // The column where the notes start must be identical on every row that has
    // notes — attributes and relationships alike.
    const cols = table
      .split("\n")
      .map((l) => l.match(/^ {2}\S.*?\s{2,}(?=\S)/)?.[0].length)
      .filter((n): n is number => n !== undefined);
    expect(cols.length).toBeGreaterThan(5);
    expect(new Set(cols).size).toBe(1);
  });

  it("says so for a schema with no fields", () => {
    expect(renderFieldsTable(describeFields({ type: "object" }))).toMatch(/no field parameters/);
  });
});
