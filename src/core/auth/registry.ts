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

/**
 * A session-less provider (e.g. static Basic) is the sole configured provider
 * that declares no login capability: it carries credentials inline and needs no
 * stored session. Used by both resolveAuth and authStatus.
 */
export function sessionlessProvider(providers: AuthProvider[]): AuthProvider | undefined {
  if (providers.length !== 1) return undefined;
  const only = providers[0];
  return only.capabilities.login === false ? only : undefined;
}
