import { describe, expect, it } from "vitest";
import { collectProviders, defaultProvider, loginCapableProviders, providerById, sessionlessProvider } from "../../../../src/core/auth/registry.js";
import type { AuthProvider } from "../../../../src/core/auth/types.js";
import type { DropSHPlugin } from "../../../../src/core/plugin.js";

function fakeProvider(id: string, login: boolean): AuthProvider {
  return {
    id,
    displayName: id.toUpperCase(),
    capabilities: { login, logout: true, status: true },
    async login() { return {}; },
    async logout() {},
    async status() { return { loggedIn: false }; },
    createAdapter() { return { async apply(r) { return r; } }; },
  };
}

function pluginWith(provider?: AuthProvider): DropSHPlugin {
  return {
    id: provider?.id ?? "noauth",
    requiredModules: [],
    ...(provider ? { authProvider: provider } : {}),
    async extendSchema(_e, _b, s) { return s; },
  };
}

describe("provider registry", () => {
  it("collects only plugins that carry an authProvider", () => {
    const p1 = fakeProvider("basic", true);
    const providers = collectProviders([pluginWith(p1), pluginWith()]);
    expect(providers.map((p) => p.id)).toEqual(["basic"]);
  });

  it("loginCapableProviders filters by capabilities.login", () => {
    const providers = [fakeProvider("a", true), fakeProvider("b", false)];
    expect(loginCapableProviders(providers).map((p) => p.id)).toEqual(["a"]);
  });

  it("providerById finds a provider or returns undefined", () => {
    const providers = [fakeProvider("a", true)];
    expect(providerById(providers, "a")?.id).toBe("a");
    expect(providerById(providers, "missing")).toBeUndefined();
  });

  it("collectProviders throws on duplicate provider ids", () => {
    const dup = fakeProvider("session", true);
    expect(() => collectProviders([pluginWith(dup), pluginWith(fakeProvider("session", true))])).toThrow(
      /duplicate auth profile id 'session'/,
    );
  });
});

describe("defaultProvider", () => {
  function withDefault(id: string, isDefault: boolean): AuthProvider {
    return { ...fakeProvider(id, true), default: isDefault };
  }
  it("returns the provider marked default:true", () => {
    const providers = [withDefault("session", true), fakeProvider("pm", true)];
    expect(defaultProvider(providers)?.id).toBe("session");
  });
  it("returns undefined when none is default", () => {
    expect(defaultProvider([fakeProvider("a", true), fakeProvider("b", true)])).toBeUndefined();
  });
  it("throws when more than one is default", () => {
    expect(() => defaultProvider([withDefault("a", true), withDefault("b", true)])).toThrow(
      /multiple auth profiles set default:true/,
    );
  });
});

describe("sessionlessProvider", () => {
  it("returns the sole login:false provider", () => {
    const p = fakeProvider("basic", false);
    expect(sessionlessProvider([p])).toBe(p);
  });
  it("returns undefined when the sole provider is login-capable", () => {
    expect(sessionlessProvider([fakeProvider("oauth", true)])).toBeUndefined();
  });
  it("returns undefined for zero providers", () => {
    expect(sessionlessProvider([])).toBeUndefined();
  });
  it("returns undefined for multiple providers", () => {
    expect(
      sessionlessProvider([fakeProvider("a", false), fakeProvider("b", false)]),
    ).toBeUndefined();
  });
});
