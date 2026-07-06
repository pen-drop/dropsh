// Multisite integration fixture coordinates.
//
// Static URLs + hardcoded credentials. Tests run against the DDEV project
// dropsh-test; each subsite is exposed at <name>.dropsh-test.ddev.site with
// its own database. The "plain" and "schemata" sites enable simple_oauth;
// "canvas" and "db" rely on basic auth against /jsonapi/* only.
//
// These credentials are NOT embedded in the dropsh config rendered by the test
// helper. They are fed to the provider's interactive login (via a stub prompt in
// `seedSession`), which then persists the resulting session to the state dir —
// matching the real `dropsh auth login` flow.

export type SiteName = "plain" | "schemata" | "canvas" | "db";

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
    url: "http://dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: OAUTH2,
    // Basic auth is fine for /jsonapi/* on the plain site and avoids the
    // per-test OAuth token roundtrip.
    defaultAuth: "basic",
  },
  schemata: {
    url: "http://schemata.dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: OAUTH2,
    // /schemata/* does not opt into basic_auth, so default to OAuth Bearer
    // (which is global). Schemata-targeted tests therefore "just work".
    defaultAuth: "oauth2_password",
  },
  canvas: {
    url: "http://canvas.dropsh-test.ddev.site",
    basic: TESTER,
    defaultAuth: "basic",
  },
  db: {
    url: "http://db.dropsh-test.ddev.site",
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
