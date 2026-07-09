import { ConfigError } from "../../errors.js";
import type { DropSHPlugin } from "../plugin.js";
import type { AuthProvider } from "./types.js";

export function collectProviders(plugins: DropSHPlugin[]): AuthProvider[] {
  const providers = plugins
    .map((p) => p.authProvider)
    .filter((p): p is AuthProvider => p !== undefined);
  const seen = new Set<string>();
  for (const p of providers) {
    if (seen.has(p.id))
      throw new ConfigError(
        `duplicate auth profile id '${p.id}'. Give each oauth2Plugin a unique 'id'.`,
      );
    seen.add(p.id);
  }
  return providers;
}

/**
 * The provider declaring `default: true`, used as the fallback profile when none
 * is active or explicitly selected. Throws if more than one claims the default.
 */
export function defaultProvider(providers: AuthProvider[]): AuthProvider | undefined {
  const defaults = providers.filter((p) => p.default === true);
  if (defaults.length > 1)
    throw new ConfigError(
      `multiple auth profiles set default:true (${defaults.map((p) => p.id).join(", ")}). Only one may.`,
    );
  return defaults[0];
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
  if (!only) return undefined;
  return only.capabilities.login === false ? only : undefined;
}
