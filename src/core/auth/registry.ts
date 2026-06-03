import type { DropSHPlugin } from "../plugin.js";
import type { AuthProvider } from "./types.js";

export function collectProviders(plugins: DropSHPlugin[]): AuthProvider[] {
  return plugins.map((p) => p.authProvider).filter((p): p is AuthProvider => p !== undefined);
}

export function loginCapableProviders(providers: AuthProvider[]): AuthProvider[] {
  return providers.filter((p) => p.capabilities.login);
}

export function providerById(providers: AuthProvider[], id: string): AuthProvider | undefined {
  return providers.find((p) => p.id === id);
}
