import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface SpikeConfig {
  url: string;
  basic: { user: string; pass: string };
}

function spikeConfig(): SpikeConfig {
  const path = resolve("tests/integrations/drupal/.spike-config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SpikeConfig;
  } catch {
    throw new Error("Spike DDEV not running. Run: npm run spike:up");
  }
}

const cfg = spikeConfig();

const AUTH = "Basic " + Buffer.from(`${cfg.basic.user}:${cfg.basic.pass}`).toString("base64");
export const BASE_URL = cfg.url.replace(/\/$/, "");

export async function jsonapi(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: AUTH,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

export async function jsonapiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

export function print(label: string, data: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}
