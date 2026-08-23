import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeFields, FIELD_PARAMETER_HELP } from "../../../../src/core/params/help.js";
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
      parameter: "--title",
      path: "title",
      type: "string",
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
      parameter: "--status",
      path: "status",
      type: "boolean",
      bare_flag: true,
    });
  });

  it("tells an array attribute to use --json", () => {
    const links = described.attributes.find((a) => a.path === "links");
    expect(links).toEqual({ parameter: "--json links=<json>", path: "links", type: "array" });
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
