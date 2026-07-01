import { loginCapableProviders, providerById } from "../core/auth/registry.js";
import {
  clearAll,
  clearProfile,
  readProfiles,
  setActive,
  writeProfile,
} from "../core/auth/session-store.js";
import type { AuthContext, AuthProvider, AuthSession, AuthStatusInfo } from "../core/auth/types.js";
import { AuthError, ConfigError } from "../errors.js";

export interface AuthDeps {
  baseUrl: string;
  providers: AuthProvider[];
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  prompt: (opts: { label: string; secret?: boolean }) => Promise<string>;
  openBrowser: (url: string) => Promise<void>;
  http: AuthContext["http"];
  now: () => number;
  isTTY: boolean;
  stateDir?: string;
}

function authContext(deps: AuthDeps): AuthContext {
  const ctx: AuthContext = {
    baseUrl: deps.baseUrl,
    http: deps.http,
    prompt: deps.prompt,
    openBrowser: deps.openBrowser,
    stdout: deps.stdout,
    now: deps.now,
  };
  if (deps.stateDir !== undefined) ctx.stateDir = deps.stateDir;
  return ctx;
}

async function pickProvider(deps: AuthDeps, requestedId?: string): Promise<AuthProvider> {
  const capable = loginCapableProviders(deps.providers);
  if (capable.length === 0) throw new ConfigError("no login-capable auth provider configured");
  if (requestedId) {
    const found = providerById(capable, requestedId);
    if (!found)
      throw new ConfigError(
        `unknown provider '${requestedId}'. Available: ${capable.map((p) => p.id).join(", ")}`,
      );
    return found;
  }
  if (!deps.isTTY) throw new ConfigError("non-interactive: pass --provider <id>");
  deps.stdout("Select an auth provider:\n");
  capable.forEach((p, i) => {
    deps.stdout(`  ${i + 1}) ${p.displayName} [${p.id}]\n`);
  });
  const answer = await deps.prompt({ label: "Number" });
  const idx = Number.parseInt(answer, 10) - 1;
  const chosen = capable[idx];
  if (!chosen) throw new ConfigError(`invalid selection '${answer}'`);
  return chosen;
}

export async function runAuthLogin(args: { provider?: string }, deps: AuthDeps): Promise<void> {
  const provider = await pickProvider(deps, args.provider);
  const session = await provider.login(authContext(deps));
  // Store under the provider id and make it the active profile (login = new default).
  await writeProfile(deps.baseUrl, provider.id, provider.id, session, deps.stateDir);
  await setActive(deps.baseUrl, provider.id, deps.stateDir);
  deps.stdout(`logged in via ${provider.displayName}\n`);
}

export async function runAuthUse(args: { profile: string }, deps: AuthDeps): Promise<void> {
  await setActive(deps.baseUrl, args.profile, deps.stateDir);
  deps.stdout(`active auth profile: ${args.profile}\n`);
}

export async function runAuthLogout(
  args: { profile?: string; all?: boolean },
  deps: AuthDeps,
): Promise<void> {
  if (args.all) {
    await clearAll(deps.baseUrl, deps.stateDir);
    deps.stdout("cleared all auth profiles\n");
    return;
  }
  const file = await readProfiles(deps.baseUrl, deps.stateDir);
  const name = args.profile ?? file?.active;
  if (!name || !file?.profiles[name]) {
    deps.stdout("not logged in\n");
    return;
  }
  const provider = providerById(deps.providers, file.profiles[name].provider);
  try {
    if (provider) await provider.logout(authContext(deps));
  } catch (err) {
    // Best-effort revoke: never block local logout on a failing revoke call.
    deps.stderr(`warning: provider logout failed: ${String(err)}\n`);
  } finally {
    await clearProfile(deps.baseUrl, name, deps.stateDir);
  }
  deps.stdout(`logged out ${name}\n`);
}

async function statusFor(
  deps: AuthDeps,
  name: string,
  providerId: string,
  session: AuthSession,
): Promise<AuthStatusInfo & { profile: string; active: boolean }> {
  const provider = providerById(deps.providers, providerId);
  const base = provider
    ? await provider.status(session)
    : { loggedIn: false, provider: providerId };
  return { ...base, profile: name, active: false };
}

export async function runAuthStatus(
  args: { json?: boolean; profile?: string },
  deps: AuthDeps,
): Promise<void> {
  const file = await readProfiles(deps.baseUrl, deps.stateDir);
  const host = new URL(deps.baseUrl).hostname;
  const names = file ? Object.keys(file.profiles) : [];
  const wanted = args.profile ? names.filter((n) => n === args.profile) : names;

  if (wanted.length === 0) {
    if (args.profile && names.length > 0)
      throw new AuthError(`no auth profile '${args.profile}' for ${host}`);
    if (args.json) deps.stdout(`${JSON.stringify({ host, profiles: {} })}\n`);
    else deps.stdout("not logged in\n");
    return;
  }

  const rows = await Promise.all(
    wanted.map(async (n) => {
      const rec = file?.profiles[n];
      const info = rec ? await statusFor(deps, n, rec.provider, rec.session) : null;
      return { name: n, active: file?.active === n, info };
    }),
  );

  if (args.json) {
    const profiles: Record<string, unknown> = {};
    for (const r of rows) profiles[r.name] = { ...r.info, active: r.active };
    deps.stdout(`${JSON.stringify({ host, active: file?.active, profiles })}\n`);
    return;
  }

  deps.stdout(`host: ${host}\n`);
  for (const r of rows) {
    const marker = r.active ? "*" : " ";
    const state =
      r.info?.expiresAt !== undefined
        ? `${r.info.state} (until ${new Date(r.info.expiresAt).toISOString()})`
        : (r.info?.state ?? (r.info?.loggedIn ? "ok" : "not logged in"));
    deps.stdout(`${marker} ${r.name}: ${state}\n`);
  }
}
