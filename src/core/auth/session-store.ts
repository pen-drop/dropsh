import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../../errors.js";
import type { AuthSession } from "./types.js";

/** One stored auth identity: the provider that owns it plus its opaque session. */
export interface ProfileRecord {
  provider: string;
  session: AuthSession;
}

/** On-disk shape (v2): a host holds many named profiles + an active pointer. */
export interface ProfilesFile {
  version: 2;
  /** Persistent default profile for this host; undefined until `auth use`/`login`. */
  active?: string;
  /** Keyed by profile name (== provider id in the current model). */
  profiles: Record<string, ProfileRecord>;
}

/** Legacy (v1) shape kept for reading old files and for the compat wrappers below. */
export interface SessionRecord {
  activeProvider: string;
  session: AuthSession;
}

export function defaultStateDir(): string {
  return join(homedir(), ".config", "dropsh");
}

function hostnameFromUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

function sessionPath(baseUrl: string, dir: string): string {
  return join(dir, `${hostnameFromUrl(baseUrl)}.json`);
}

function isLegacy(raw: unknown): raw is SessionRecord {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "activeProvider" in raw &&
    typeof (raw as SessionRecord).activeProvider === "string"
  );
}

/**
 * Read the whole profiles file, migrating a legacy `{ activeProvider, session }`
 * record in memory to the v2 shape. No write-time migration is needed: the next
 * `writeProfile` persists v2 naturally.
 */
export async function readProfiles(baseUrl: string, dir?: string): Promise<ProfilesFile | null> {
  const path = sessionPath(baseUrl, dir ?? defaultStateDir());
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
  if (isLegacy(raw)) {
    return {
      version: 2,
      active: raw.activeProvider,
      profiles: { [raw.activeProvider]: { provider: raw.activeProvider, session: raw.session } },
    };
  }
  const file = raw as Partial<ProfilesFile>;
  if (typeof file !== "object" || file === null || typeof file.profiles !== "object") return null;
  return {
    version: 2,
    profiles: file.profiles ?? {},
    ...(typeof file.active === "string" ? { active: file.active } : {}),
  };
}

export async function readProfile(
  baseUrl: string,
  name: string,
  dir?: string,
): Promise<ProfileRecord | null> {
  const file = await readProfiles(baseUrl, dir);
  return file?.profiles[name] ?? null;
}

async function writeFileAtomic(path: string, file: ProfilesFile, stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  // writeFile's `mode` only applies when creating a new file; overwriting an
  // existing file keeps its old (possibly looser) permissions, so tighten explicitly.
  await chmod(path, 0o600);
}

/**
 * Upsert a single profile slot, merging into the existing file so other slots and
 * the `active` pointer are preserved. Used both by `auth login` and by adapter
 * token renewals (which must never disturb sibling profiles).
 */
export async function writeProfile(
  baseUrl: string,
  name: string,
  provider: string,
  session: AuthSession,
  dir?: string,
): Promise<void> {
  const stateDir = dir ?? defaultStateDir();
  const file = (await readProfiles(baseUrl, stateDir)) ?? { version: 2, profiles: {} };
  file.profiles[name] = { provider, session };
  await writeFileAtomic(sessionPath(baseUrl, stateDir), file, stateDir);
}

/** Set the persistent active pointer. Errors if the slot has no stored session. */
export async function setActive(baseUrl: string, name: string, dir?: string): Promise<void> {
  const stateDir = dir ?? defaultStateDir();
  const file = await readProfiles(baseUrl, stateDir);
  if (!file?.profiles[name])
    throw new ConfigError(
      `no auth profile '${name}' for this host. Run 'dropsh auth login --provider ${name}'.`,
    );
  file.active = name;
  await writeFileAtomic(sessionPath(baseUrl, stateDir), file, stateDir);
}

/** Remove a single profile; unset `active` if it pointed there; delete the file if empty. */
export async function clearProfile(baseUrl: string, name: string, dir?: string): Promise<void> {
  const stateDir = dir ?? defaultStateDir();
  const file = await readProfiles(baseUrl, stateDir);
  if (!file?.profiles[name]) return;
  delete file.profiles[name];
  if (file.active === name) delete file.active;
  const path = sessionPath(baseUrl, stateDir);
  if (Object.keys(file.profiles).length === 0) {
    await rm(path, { force: true });
    return;
  }
  await writeFileAtomic(path, file, stateDir);
}

/** Remove every profile for this host (deletes the file). */
export async function clearAll(baseUrl: string, dir?: string): Promise<void> {
  await rm(sessionPath(baseUrl, dir ?? defaultStateDir()), { force: true });
}

// --- Legacy (v1) compatibility API -----------------------------------------
// Existing callers/tests use these single-session helpers. They now operate on
// the active profile of the v2 store, so old and new code interoperate.

export async function readSession(baseUrl: string, dir?: string): Promise<SessionRecord | null> {
  const file = await readProfiles(baseUrl, dir);
  if (!file?.active) return null;
  const rec = file.profiles[file.active];
  return rec ? { activeProvider: file.active, session: rec.session } : null;
}

export async function writeSession(
  baseUrl: string,
  activeProvider: string,
  session: AuthSession,
  dir?: string,
): Promise<void> {
  await writeProfile(baseUrl, activeProvider, activeProvider, session, dir);
  await setActive(baseUrl, activeProvider, dir);
}

export async function clearSession(baseUrl: string, dir?: string): Promise<void> {
  await clearAll(baseUrl, dir);
}
