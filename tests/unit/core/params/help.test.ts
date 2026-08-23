import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findCachedSchema, renderFieldHelp } from "../../../../src/core/params/help.js";
import { indexSchemaFields } from "../../../../src/core/params/schema-fields.js";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "../../fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;
const createSchema = toOperationVariant(RAW, "create");

describe("renderFieldHelp", () => {
  it("falls back to the generic forms when no schema is cached", () => {
    const text = renderFieldHelp(undefined);
    expect(text).toMatch(/--<field> <value>/);
    expect(text).toMatch(/--json <field>=<json>/);
    expect(text).toMatch(/dropsh schema <entity>\/<bundle>/);
    // It must not pretend to name this bundle's fields.
    expect(text).not.toMatch(/Field parameters for/);
    expect(text).not.toMatch(/Attributes:/);
    expect(text).not.toMatch(/Relationships/);
  });

  it("lists the bundle's scalar attributes by name", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex.ddev.site" });
    expect(text).toMatch(/--title/);
    expect(text).toMatch(/--status/);
    expect(text).toMatch(/--weight/);
  });

  it("expands an object attribute into its dotted sub-paths", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex.ddev.site" });
    expect(text).toMatch(/--body\.value/);
    expect(text).toMatch(/--body\.format/);
    expect(text).toMatch(/--body\.summary/);
  });

  it("names a relationship's single target type", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex.ddev.site" });
    expect(text).toMatch(/--uid <uuid>\s+user--user/);
  });

  it("marks a multi-valued relationship as repeatable", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex.ddev.site" });
    expect(text).toMatch(/--field_tags .*taxonomy_term--tags.*repeatable/);
  });

  it("shows the <type>:<uuid> form for an ambiguous relationship", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex.ddev.site" });
    expect(text).toMatch(/--field_ref <type>:<uuid>/);
    expect(text).toMatch(/node--article \| node--page/);
  });

  it("names the host the cached schema came from", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex.ddev.site" });
    expect(text).toMatch(/ex\.ddev\.site/);
  });

  it("keeps a separator when a field name overflows the flag column", () => {
    const long = "revision_translation_affected";
    const schema = {
      properties: {
        data: {
          properties: {
            type: { const: "node--article" },
            attributes: { properties: { [long]: { type: "boolean" } } },
          },
        },
      },
    };
    const text = renderFieldHelp({ index: indexSchemaFields(schema), host: "ex" });
    expect(text).not.toMatch(new RegExp(`--${long} <value>true`));
    expect(text).toMatch(new RegExp(`--${long} <value>\\s+true\\|false`));
  });

  it("aligns every hint in one column", () => {
    const text = renderFieldHelp({ index: indexSchemaFields(createSchema), host: "ex" });
    const columns = text
      .split("\n")
      .filter((l) => /^ {2}--\S+ <value>\s+\S/.test(l))
      .map((l) => l.indexOf(l.trimStart().split(/\s{2,}/)[1] as string));
    expect(new Set(columns).size).toBe(1);
  });

  it("says so when the cached schema declares no fields at all", () => {
    const text = renderFieldHelp({ index: indexSchemaFields({ type: "object" }), host: "ex" });
    expect(text).toMatch(/declares no fields/);
  });
});

describe("findCachedSchema", () => {
  function seed(cwd: string, host: string, file: string): void {
    const abs = join(cwd, ".dropsh/cache", host, "schema", file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(createSchema), "utf8");
  }

  it("finds a cached operation schema and reports its host", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-help-"));
    seed(cwd, "ex.ddev.site", "node--article.create.json");
    const hit = findCachedSchema(cwd, "node", "article", "create");
    expect(hit?.host).toBe("ex.ddev.site");
    expect(indexSchemaFields(hit?.schema).fields.has("title")).toBe(true);
  });

  it("returns undefined when nothing is cached", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-help-"));
    expect(findCachedSchema(cwd, "node", "article", "create")).toBeUndefined();
  });

  it("does not confuse another bundle's cache entry", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-help-"));
    seed(cwd, "ex.ddev.site", "node--page.create.json");
    expect(findCachedSchema(cwd, "node", "article", "create")).toBeUndefined();
  });

  it("distinguishes the create and update variants", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-help-"));
    seed(cwd, "ex.ddev.site", "node--article.update.json");
    expect(findCachedSchema(cwd, "node", "article", "create")).toBeUndefined();
    expect(findCachedSchema(cwd, "node", "article", "update")?.host).toBe("ex.ddev.site");
  });

  it("survives an unreadable cache file instead of throwing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-help-"));
    const abs = join(cwd, ".dropsh/cache/ex/schema/node--article.create.json");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "{ not json", "utf8");
    expect(findCachedSchema(cwd, "node", "article", "create")).toBeUndefined();
  });
});
