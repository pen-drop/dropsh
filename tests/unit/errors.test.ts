import { describe, expect, it } from "vitest";
import {
  AuthError,
  CliError,
  ConfigError,
  exitCodeFor,
  HttpError,
  PluginError,
  ValidationError,
} from "../../src/errors.js";

describe("errors", () => {
  it("CliError carries code, message, details", () => {
    const err = new CliError("E_GENERIC", "boom", { hint: "x" });
    expect(err.code).toBe("E_GENERIC");
    expect(err.message).toBe("boom");
    expect(err.details).toEqual({ hint: "x" });
  });

  it("ConfigError uses E_CONFIG", () => {
    expect(new ConfigError("bad yaml").code).toBe("E_CONFIG");
  });

  it("AuthError uses E_AUTH", () => {
    expect(new AuthError("bad creds").code).toBe("E_AUTH");
  });

  it("HttpError carries status and body", () => {
    const err = new HttpError(422, "unprocessable", { errors: [] });
    expect(err.code).toBe("E_HTTP");
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ errors: [] });
  });

  it("ValidationError uses E_VALIDATION", () => {
    expect(new ValidationError("missing title").code).toBe("E_VALIDATION");
  });

  it("PluginError identifies the plugin and hook", () => {
    const err = new PluginError("tenant", "alterRequest", new Error("boom"));
    expect(err.name).toBe("PluginError");
    expect(err.code).toBe("E_PLUGIN");
    expect(err.message).toContain("tenant");
    expect(err.details).toMatchObject({ pluginId: "tenant", hook: "alterRequest" });
    expect(exitCodeFor(err)).toBe(6);
  });

  it("exitCodeFor maps each error class", () => {
    expect(exitCodeFor(new ConfigError("x"))).toBe(2);
    expect(exitCodeFor(new AuthError("x"))).toBe(3);
    expect(exitCodeFor(new ValidationError("x"))).toBe(4);
    expect(exitCodeFor(new HttpError(500, "x"))).toBe(5);
    expect(exitCodeFor(new PluginError("test", "alterRequest", "x"))).toBe(6);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});
