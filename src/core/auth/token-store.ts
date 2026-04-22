import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

function hostnameFromUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

export function defaultTokenDir(): string {
  return join(homedir(), ".config", "drupal-cli");
}

export async function readToken(baseUrl: string, dir?: string): Promise<StoredToken | null> {
  const tokenDir = dir ?? defaultTokenDir();
  const tokenPath = join(tokenDir, `${hostnameFromUrl(baseUrl)}.json`);
  try {
    const raw = await readFile(tokenPath, "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export async function writeToken(baseUrl: string, token: StoredToken, dir?: string): Promise<void> {
  const tokenDir = dir ?? defaultTokenDir();
  await mkdir(tokenDir, { recursive: true });
  const tokenPath = join(tokenDir, `${hostnameFromUrl(baseUrl)}.json`);
  await writeFile(tokenPath, JSON.stringify(token, null, 2), { encoding: "utf8", mode: 0o600 });
}
