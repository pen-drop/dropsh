import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TestConfig {
  url: string;
  basic: { user: string; pass: string };
  oauth2: {
    scope: string;
    password_client_id: string;
    password_client_secret: string;
    cc_client_id: string;
    cc_client_secret: string;
    user: string;
    pass: string;
  };
}

export function testConfig(): TestConfig {
  const path = resolve("tests/integrations/drupal/.test-config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TestConfig;
  } catch {
    throw new Error("Integration tests require a running DDEV. Run: npm run drupal:up");
  }
}
