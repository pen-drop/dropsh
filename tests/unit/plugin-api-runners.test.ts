import {
  applyOperationSchemaPlugins,
  fetchCatalog,
  fetchJsonSchema,
  runCreate,
  runRead,
  runSearch,
  runUpdate,
  toOperationVariant,
  ValidationError,
  validatePayload,
} from "dropsh/plugin";
import { describe, expect, it } from "vitest";

describe("command runner exports", () => {
  it("exports consumed runners, schema helpers and ValidationError from dropsh/plugin", () => {
    expect(typeof runRead).toBe("function");
    expect(typeof runSearch).toBe("function");
    expect(typeof runCreate).toBe("function");
    expect(typeof runUpdate).toBe("function");
    expect(typeof fetchCatalog).toBe("function");
    expect(typeof fetchJsonSchema).toBe("function");
    expect(typeof toOperationVariant).toBe("function");
    expect(typeof applyOperationSchemaPlugins).toBe("function");
    expect(typeof validatePayload).toBe("function");
    expect(new ValidationError("x").code).toBe("E_VALIDATION");
  });
});
