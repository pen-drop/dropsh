import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePayload } from "../../../../src/core/schema/validate.js";
import { ValidationError } from "../../../../src/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/payloads", name), "utf8")) as T;
}

const schema = {
  $schema: "https://json-schema.org/draft-07/schema",
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        type: { const: "node--article" },
        attributes: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "object" },
          },
          required: ["title"],
        },
      },
      required: ["type", "attributes"],
    },
  },
  required: ["data"],
};

describe("validatePayload", () => {
  it("returns ok for a valid payload", () => {
    const payload = load("article-valid.json");
    expect(() => validatePayload(schema, payload, "node/article")).not.toThrow();
  });

  it("throws ValidationError with ajv errors when required field missing", () => {
    const payload = load("article-missing-title.json");
    let caught: unknown;
    try {
      validatePayload(schema, payload, "node/article");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const e = caught as ValidationError;
    expect(e.message).toContain("node/article");
    const errs = e.details.errors as Array<{ instancePath: string; message: string }>;
    expect(errs.some((x) => x.instancePath === "/data/attributes" && /required/i.test(x.message))).toBe(true);
  });

  it("throws ValidationError when schema itself cannot be compiled", () => {
    const bad = { type: "not-a-type" };
    let caught: unknown;
    try {
      validatePayload(bad, {}, "node/article");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).toMatch(/cannot be compiled/);
  });
});
