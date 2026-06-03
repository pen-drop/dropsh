import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthSession } from "./types.js";

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

export async function readSession(baseUrl: string, dir?: string): Promise<SessionRecord | null> {
  const path = sessionPath(baseUrl, dir ?? defaultStateDir());
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export async function writeSession(
  baseUrl: string,
  activeProvider: string,
  session: AuthSession,
  dir?: string,
): Promise<void> {
  const stateDir = dir ?? defaultStateDir();
  await mkdir(stateDir, { recursive: true });
  const record: SessionRecord = { activeProvider, session };
  await writeFile(sessionPath(baseUrl, stateDir), JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function clearSession(baseUrl: string, dir?: string): Promise<void> {
  await rm(sessionPath(baseUrl, dir ?? defaultStateDir()), { force: true });
}
