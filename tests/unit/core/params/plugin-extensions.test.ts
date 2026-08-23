import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { applyOperationSchemaPlugins } from "../../../../src/commands/schema.js";
import type { AuthAdapter } from "../../../../src/core/auth/types.js";
import type { HttpClient } from "../../../../src/core/http.js";
import { parseFieldArgs } from "../../../../src/core/params/parse-args.js";
import { buildPayloadFromParameters } from "../../../../src/core/params/from-parameters.js";
import type { DropSHPlugin } from "../../../../src/core/plugin.js";
import { toOperationVariant } from "../../../../src/core/schema/to-jsonschema.js";
import { ValidationError } from "../../../../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(here, "../../fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;

interface JsonSchemaNode {
  properties: {
    data: { properties: { attributes: { properties: Record<string, unknown> } } };
  };
}

/** Adds one attribute the base schema does not declare. */
const extPlugin: DropSHPlugin = {
  id: "ext",
  requiredModules: [],
  extendOperationSchema: async (_entity, _bundle, _op, schema) => {
    const clone = JSON.parse(JSON.stringify(schema)) as JsonSchemaNode;
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
