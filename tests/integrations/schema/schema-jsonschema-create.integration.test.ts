import Ajv from "ajv";
import draft6 from "ajv/dist/refs/json-schema-draft-06.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema (schemata path, --for=create)", () => {
  it("returns a schemata-sourced schema that Ajv can compile", async () => {
    const result = await runCli({
      site: "schemata",
      args: ["schema", "node/article_test", "--refresh"],
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(""); // no "no 'schemata' module" warning
    // biome-ignore lint/suspicious/noExplicitAny: runtime schema shape from schemata
    const schema = parseJson<any>(result.stdout);
    expect(schema["x-dropsh-source"]).toBe("schemata");
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false });
    ajv.removeKeyword("id");
    if (!ajv.getSchema("http://json-schema.org/draft-06/schema#")) ajv.addMetaSchema(draft6);
    const validate = ajv.compile(schema);
    // a valid payload passes
    const ok = {
      data: {
        type: "node--article_test",
        attributes: { title: "from-test" },
      },
    };
    expect(validate(ok)).toBe(true);
    // a payload missing title fails
    const bad = { data: { type: "node--article_test", attributes: {} } };
    expect(validate(bad)).toBe(false);
  });
});
