// Multisite integration fixture coordinates.
//
// Hardcoded credentials; URLs derived from the DDEV project name so the suite
// follows a per-worktree project (see `pnpm run init-worktree`) instead of a
// fixed hostname. The base project is `dropsh-test`; each subsite is exposed at
// <site>.<project>.ddev.site with its own database. The "plain" and "schemata"
// sites enable simple_oauth; "canvas" and "db" rely on basic auth against
// /jsonapi/* only.
//
// These credentials are NOT embedded in the dropsh config rendered by the test
// helper. They are fed to the provider's interactive login (via a stub prompt in
// `seedSession`), which then persists the resulting session to the state dir —
// matching the real `dropsh auth login` flow.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SiteName = "plain" | "schemata" | "jsonapischema" | "canvas" | "db";

const DDEV_DIR = join(dirname(fileURLToPath(import.meta.url)), "../drupal/.ddev");

/** Extract the top-level `name:` value from a DDEV config YAML. Pure. */
export function parseDdevName(yaml: string): string | null {
  const m = yaml.match(/^name:[ \t]*(\S+)[ \t]*$/m);
  return m?.[1] ?? null;
}

/** Build the JSON:API base URL for a site given the DDEV project name. Pure. */
export function siteUrl(site: SiteName, project: string): string {
  return site === "plain" ? `http://${project}.ddev.site` : `http://${site}.${project}.ddev.site`;
}

// Effective DDEV project name: the per-worktree override wins, then the base
// config, then the historical default. Read once at module load.
function resolveDdevProject(): string {
  for (const file of ["config.local.yaml", "config.yaml"]) {
    try {
      const name = parseDdevName(readFileSync(join(DDEV_DIR, file), "utf8"));
      if (name) return name;
    } catch {
      // File absent in this checkout — fall through to the next candidate.
    }
  }
  return "dropsh-test";
}

const DDEV_PROJECT = resolveDdevProject();

export interface OAuth2Config {
  scope: string;
  password_client_id: string;
  password_client_secret: string;
  cc_client_id: string;
  cc_client_secret: string;
  user: string;
  pass: string;
}

/** Auth method that runCli should use by default for a given site. */
export type DefaultAuth = "basic" | "oauth2_password";

export interface TestConfig {
  url: string;
  basic: { user: string; pass: string };
  oauth2?: OAuth2Config;
  /** runCli falls back to this when callers don't pass an explicit `auth`. */
  defaultAuth: DefaultAuth;
}

const TESTER = { user: "tester", pass: "tester-pw" };

const OAUTH2 = {
  scope: "integration:content",
  password_client_id: "tests-password",
  password_client_secret: "tests-password-secret",
  cc_client_id: "tests-cc",
  cc_client_secret: "tests-cc-secret",
  user: TESTER.user,
  pass: TESTER.pass,
};

const SITES: Record<SiteName, TestConfig> = {
  plain: {
    url: siteUrl("plain", DDEV_PROJECT),
    basic: TESTER,
    oauth2: OAUTH2,
    // Basic auth is fine for /jsonapi/* on the plain site and avoids the
    // per-test OAuth token roundtrip.
    defaultAuth: "basic",
  },
  schemata: {
    url: siteUrl("schemata", DDEV_PROJECT),
    basic: TESTER,
    oauth2: OAUTH2,
    // /schemata/* does not opt into basic_auth, so default to OAuth Bearer
    // (which is global). Schemata-targeted tests therefore "just work".
    defaultAuth: "oauth2_password",
  },
  jsonapischema: {
    url: siteUrl("jsonapischema", DDEV_PROJECT),
    basic: TESTER,
    oauth2: OAUTH2,
    // jsonapi_schema's schema routes do NOT declare `_auth`, so Drupal core
    // basic_auth (global: false) cannot authenticate them — an authenticated
    // basic request is rejected 403. Default to OAuth Bearer (global: true),
    // like the schemata site, which authenticates those routes.
    defaultAuth: "oauth2_password",
  },
  canvas: {
    url: siteUrl("canvas", DDEV_PROJECT),
    basic: TESTER,
    defaultAuth: "basic",
  },
  db: {
    url: siteUrl("db", DDEV_PROJECT),
    basic: TESTER,
    defaultAuth: "basic",
  },
};

/** Coordinates for an integration subsite. Defaults to "plain". */
export function testConfig(site: SiteName = "plain"): TestConfig {
  return SITES[site];
}

/** OAuth credentials for sites that enable simple_oauth. Throws otherwise. */
export function oauth2Config(site: SiteName = "plain"): OAuth2Config {
  const cfg = SITES[site];
  if (!cfg.oauth2) {
    throw new Error(`Site '${site}' has no simple_oauth — use site: "plain" for OAuth tests.`);
  }
  return cfg.oauth2;
}
