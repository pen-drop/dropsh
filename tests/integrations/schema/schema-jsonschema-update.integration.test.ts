import Ajv from "ajv";
import draft6 from "ajv/dist/refs/json-schema-draft-06.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "../helpers/run.js";

describe("integration: schema (schemata path, --for=update)", () => {
  it("allows a partial payload when update variant is requested", async () => {
    const result = await runCli({
      args: ["schema", "node/article_test", "--for=update", "--refresh"],
    });
    expect(result.code).toBe(0);
    // biome-ignore lint/suspicious/noExplicitAny: runtime schema shape from schemata
    const schema = parseJson<any>(result.stdout);
    expect(schema["x-drupal-cli-operation"]).toBe("update");
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false });
    ajv.removeKeyword("id");
    if (!ajv.getSchema("http://json-schema.org/draft-06/schema#")) ajv.addMetaSchema(draft6);
    const validate = ajv.compile(schema);
    // partial payload (no title, only body)
    const partial = {
      data: {
        type: "node--article_test",
        id: "00000000-0000-0000-0000-000000000000",
        attributes: { body: { value: "x", format: "plain_text" } },
      },
    };
    expect(validate(partial)).toBe(true);
  });
});
