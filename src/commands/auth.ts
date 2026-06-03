import { loginCapableProviders, providerById } from "../core/auth/registry.js";
import { clearSession, readSession, writeSession } from "../core/auth/session-store.js";
import type { AuthContext, AuthProvider } from "../core/auth/types.js";
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
  if (capable.length === 1) return capable[0] as AuthProvider;
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
  await writeSession(deps.baseUrl, provider.id, session, deps.stateDir);
  deps.stdout(`logged in via ${provider.displayName}\n`);
}

export async function runAuthLogout(_args: Record<string, never>, deps: AuthDeps): Promise<void> {
  const rec = await readSession(deps.baseUrl, deps.stateDir);
  if (!rec) {
    deps.stdout("not logged in\n");
    return;
  }
  const provider = providerById(deps.providers, rec.activeProvider);
  try {
    if (provider) await provider.logout(authContext(deps));
  } catch (err) {
    // Best-effort revoke: never block local logout on a failing revoke call.
    deps.stderr(`warning: provider logout failed: ${String(err)}\n`);
  } finally {
    await clearSession(deps.baseUrl, deps.stateDir);
  }
  deps.stdout("logged out\n");
}

export async function runAuthStatus(args: { json?: boolean }, deps: AuthDeps): Promise<void> {
  const rec = await readSession(deps.baseUrl, deps.stateDir);
  if (!rec) {
    if (args.json) deps.stdout(`${JSON.stringify({ loggedIn: false })}\n`);
    else deps.stdout("not logged in\n");
    return;
  }
  const provider = providerById(deps.providers, rec.activeProvider);
  if (!provider) throw new AuthError(`active provider '${rec.activeProvider}' is not configured`);
  const info = await provider.status(rec.session);
  const host = new URL(deps.baseUrl).hostname;
  if (args.json) {
    deps.stdout(`${JSON.stringify({ ...info, host })}\n`);
    return;
  }
  deps.stdout(`provider: ${provider.displayName} [${provider.id}]\n`);
  deps.stdout(`host: ${host}\n`);
  if (info.expiresAt !== undefined)
    deps.stdout(`token: ${info.state} (until ${new Date(info.expiresAt).toISOString()})\n`);
}
