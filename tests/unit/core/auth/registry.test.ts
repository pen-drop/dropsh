import { describe, expect, it } from "vitest";
import { collectProviders, loginCapableProviders, providerById } from "../../../../src/core/auth/registry.js";
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
});
