// Multisite integration fixture coordinates.
//
// Static URLs + hardcoded credentials. Tests run against the DDEV project
// dropsh-test; each subsite is exposed at <name>.dropsh-test.ddev.site with
// its own database. OAuth credentials live only on the "plain" site because
// only that site enables simple_oauth.

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
  oauth2?: OAuth2Config;
}

const TESTER = { user: "tester", pass: "tester-pw" };

const SITES: Record<SiteName, TestConfig> = {
  plain: {
    url: "http://dropsh-test.ddev.site",
    basic: TESTER,
    oauth2: {
      scope: "integration:content",
      password_client_id: "tests-password",
      password_client_secret: "tests-password-secret",
      cc_client_id: "tests-cc",
      cc_client_secret: "tests-cc-secret",
      user: TESTER.user,
      pass: TESTER.pass,
    },
  },
  schemata: {
    url: "http://schemata.dropsh-test.ddev.site",
    basic: TESTER,
  },
  canvas: {
    url: "http://canvas.dropsh-test.ddev.site",
    basic: TESTER,
  },
  db: {
    url: "http://db.dropsh-test.ddev.site",
    basic: TESTER,
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
