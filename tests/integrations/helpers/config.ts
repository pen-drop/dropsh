// Multisite integration fixture coordinates.
//
// All values are static (no .test-config.json handover): URLs are determined
// by the DDEV project name (dropsh-test), credentials are hardcoded in the
// Drupal fixture scripts (fixtures/setup-*.php). This file is the canonical
// source for tests.

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

export interface TestConfig {
  url: string;
  basic: { user: string; pass: string };
  oauth2: OAuth2Config;
}

const TESTER = { user: "tester", pass: "tester-pw" };

const OAUTH2: OAuth2Config = {
  scope: "integration:content",
  password_client_id: "tests-password",
  password_client_secret: "tests-password-secret",
  cc_client_id: "tests-cc",
  cc_client_secret: "tests-cc-secret",
  user: TESTER.user,
  pass: TESTER.pass,
};

const EMPTY_OAUTH: OAuth2Config = {
  scope: "",
  password_client_id: "",
  password_client_secret: "",
  cc_client_id: "",
  cc_client_secret: "",
  user: TESTER.user,
  pass: TESTER.pass,
};

const SITES: Record<SiteName, TestConfig> = {
  plain: {
    url: "http://dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: OAUTH2,
  },
  schemata: {
    url: "http://schemata.dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: EMPTY_OAUTH,
  },
  canvas: {
    url: "http://canvas.dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: EMPTY_OAUTH,
  },
  db: {
    url: "http://db.dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: EMPTY_OAUTH,
  },
};

/**
 * Returns the config for an integration site. Defaults to "plain".
 */
export function testConfig(site: SiteName = "plain"): TestConfig {
  return SITES[site];
}
