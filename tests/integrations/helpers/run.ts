import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { oauth2Plugin } from "../../../plugins/oauth2/src/index.js";
import { basicAuthProvider } from "../../../src/core/auth/basic.js";
import { writeSession } from "../../../src/core/auth/session-store.js";
import type { AuthContext, AuthProvider } from "../../../src/core/auth/types.js";
import { createHttpClient } from "../../../src/core/http.js";
import { oauth2Config, type SiteName, testConfig } from "./config.js";

export { testConfig } from "./config.js";

export type Auth =
  | { type: "basic"; user: string; pass: string }
  | {
      type: "oauth2_password";
      clientId: string;
      clientSecret: string;
      user: string;
      pass: string;
      scope?: string;
    }
  | {
      type: "oauth2_client_credentials";
      clientId: string;
      clientSecret: string;
      scope?: string;
    };

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ErrorPayload {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export interface RunOptions {
  /** Target subsite; defaults to "plain". */
  site?: SiteName;
  /** Override URL explicitly (rare; site is preferred). */
  url?: string;
  auth?: Auth;
  args: string[];
  /**
   * Home dir for the spawned CLI. The runtime auth resolver reads the active
   * session from `<home>/.config/dropsh/<host>.json`. When omitted, `seedSession`
   * has already created a fresh home for this auth and runCli reuses it.
   */
  home?: string;
}

const PLUGIN_BY_SITE: Record<SiteName, string | null> = {
  plain: null,
  schemata: "schemata",
  jsonapischema: "jsonapi-schema",
  canvas: "canvas",
  db: "display-builder",
};

function pluginImport(plugin: string): { importLine: string; instantiation: string } {
  const sourcePath = pathToFileURL(resolve(`plugins/${plugin}/src/index.js`)).href;
  if (plugin === "schemata") {
    return {
      importLine: `import { schemataPlugin } from ${JSON.stringify(sourcePath)};`,
      instantiation: "schemataPlugin()",
    };
  }
  if (plugin === "jsonapi-schema") {
    return {
      importLine: `import { jsonapiSchemaPlugin } from ${JSON.stringify(sourcePath)};`,
      instantiation: "jsonapiSchemaPlugin()",
    };
  }
  if (plugin === "canvas") {
    return {
      importLine: `import { canvasPlugin } from ${JSON.stringify(sourcePath)};`,
      instantiation: "canvasPlugin()",
    };
  }
  if (plugin === "display-builder") {
    return {
      importLine: `import { displayBuilderPlugin } from ${JSON.stringify(sourcePath)};`,
      instantiation: "displayBuilderPlugin()",
    };
  }
  throw new Error(`Unknown plugin '${plugin}'`);
}

/**
 * Render a dropsh config that carries only NON-SECRET connection params. The
 * provider plugin matching `auth` is registered so the runtime can resolve the
 * session seeded by `seedSession`. Secrets are never written here.
 */
function renderConfig(url: string, auth: Auth, site: SiteName): string {
  const oauthSrc = pathToFileURL(resolve("plugins/oauth2/src/index.js")).href;
  const basicSrc = pathToFileURL(resolve("src/core/auth/basic.js")).href;
  const tokenUrl = `${url.replace(/\/$/, "")}/oauth/token`;

  const sitePlugin = PLUGIN_BY_SITE[site];
  const pluginExtras = sitePlugin ? pluginImport(sitePlugin) : null;

  const importLines: string[] = [];
  const pluginLines: string[] = [];

  if (auth.type === "basic") {
    importLines.push(`import { basicAuthPlugin } from ${JSON.stringify(basicSrc)};`);
    pluginLines.push("    basicAuthPlugin(),");
  } else {
    importLines.push(`import { oauth2Plugin } from ${JSON.stringify(oauthSrc)};`);
    if (auth.type === "oauth2_password") {
      pluginLines.push(
        "    oauth2Plugin({",
        "      type: 'oauth2_password',",
        `      client_id: ${JSON.stringify(auth.clientId)},`,
        `      username: ${JSON.stringify(auth.user)},`,
        `      token_url: ${JSON.stringify(tokenUrl)},`,
        ...(auth.scope ? [`      scope: ${JSON.stringify(auth.scope)},`] : []),
        "    }),",
      );
    } else {
      pluginLines.push(
        "    oauth2Plugin({",
        "      type: 'oauth2_client_credentials',",
        `      client_id: ${JSON.stringify(auth.clientId)},`,
        `      token_url: ${JSON.stringify(tokenUrl)},`,
        ...(auth.scope ? [`      scope: ${JSON.stringify(auth.scope)},`] : []),
        "    }),",
      );
    }
  }

  if (pluginExtras) {
    importLines.push(pluginExtras.importLine);
    pluginLines.push(`    ${pluginExtras.instantiation},`);
  }

  return [
    ...importLines,
    "",
    "export default {",
    `  site: { base_url: ${JSON.stringify(url)}, jsonapi_prefix: '/jsonapi' },`,
    "  defaults: { dry_run: false, timeout_ms: 30000 },",
    "  plugins: [",
    ...pluginLines,
    "  ],",
    "};",
    "",
  ].join("\n");
}

/** Build the AuthProvider for an `Auth` and the secret value its login prompts for. */
function providerFor(url: string, auth: Auth): { provider: AuthProvider; secret: string } {
  const tokenUrl = `${url.replace(/\/$/, "")}/oauth/token`;
  if (auth.type === "basic") {
    const provider = basicAuthProvider();
    return { provider, secret: auth.pass };
  }
  if (auth.type === "oauth2_password") {
    const provider = oauth2Plugin({
      type: "oauth2_password",
      client_id: auth.clientId,
      username: auth.user,
      token_url: tokenUrl,
      ...(auth.scope ? { scope: auth.scope } : {}),
    }).authProvider as AuthProvider;
    return { provider, secret: auth.clientSecret };
  }
  const provider = oauth2Plugin({
    type: "oauth2_client_credentials",
    client_id: auth.clientId,
    token_url: tokenUrl,
    ...(auth.scope ? { scope: auth.scope } : {}),
  }).authProvider as AuthProvider;
  return { provider, secret: auth.clientSecret };
}

/**
 * Drive a provider's interactive login against the live site and persist the
 * resulting session under a fresh tmp home. Returns the home dir to pass to
 * `runCli` so the spawned CLI resolves the seeded session at runtime.
 *
 * For basic auth the login prompts username + password; for the oauth2 password
 * grant it prompts client_secret + password; for client_credentials it prompts
 * client_secret. The stub `prompt` answers each label from the `Auth` payload.
 *
 * NOTE: the `oauth2_authcode` (browser PKCE) flow is NOT seeded here — it cannot
 * be driven non-interactively. To test it by hand run `dropsh auth login
 * --provider oauth2_authcode` against the plain site, complete the browser
 * redirect, then run a `read`/`search` command with the same config.
 */
export async function seedSession(url: string, auth: Auth): Promise<string> {
  const { provider, secret } = providerFor(url, auth);
  const http = createHttpClient({ timeoutMs: 30_000 });

  const answers: Record<string, string> = {};
  if (auth.type === "basic") {
    answers.Username = auth.user;
    answers.Password = auth.pass;
  } else {
    answers["Client secret"] = secret;
    if (auth.type === "oauth2_password") answers.Password = auth.pass;
  }

  const ctx: AuthContext = {
    baseUrl: url,
    http,
    async prompt({ label }) {
      return answers[label] ?? "";
    },
    async openBrowser() {
      throw new Error("openBrowser is not supported in non-interactive integration tests");
    },
    stdout() {},
    // Must be the real clock: the provider computes the session's expires_at
    // from now() + expires_in, and the spawned CLI checks it against Date.now().
    now: () => Date.now(),
  };

  const session = await provider.login(ctx);

  const home = mkdtempSync(join(tmpdir(), "dropsh-home-"));
  const stateDir = join(home, ".config", "dropsh");
  await writeSession(url, provider.id, session, stateDir);
  return home;
}

export async function runCli(opts: RunOptions): Promise<RunResult> {
  const site = opts.site ?? "plain";
  const cfg = testConfig(site);
  const url = opts.url ?? cfg.url;
  const auth =
    opts.auth ?? (cfg.defaultAuth === "oauth2_password" ? oauth2Password(site) : basicAuth(site));

  // Seed the active session (real login against the live site) unless the caller
  // already produced a home dir holding one.
  const home = opts.home ?? (await seedSession(url, auth));

  const dir = mkdtempSync(join(tmpdir(), "dropsh-it-"));
  const cfgPath = join(dir, "dropsh.config.mjs");
  writeFileSync(cfgPath, renderConfig(url, auth, site), "utf8");

  return await new Promise<RunResult>((resolve) => {
    const child = spawn("node", ["--import", "tsx/esm", "bin/dropsh-src", ...opts.args], {
      env: {
        ...process.env,
        HOME: home,
        DROPSH_CONFIG: cfgPath,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function parseJson<T = unknown>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

export function parseError(stderr: string): ErrorPayload {
  return JSON.parse(stderr) as ErrorPayload;
}

export function basicAuth(site: SiteName = "plain"): Auth {
  const cfg = testConfig(site);
  return { type: "basic", user: cfg.basic.user, pass: cfg.basic.pass };
}

export function oauth2Password(site: SiteName = "plain"): Auth {
  const oauth = oauth2Config(site);
  return {
    type: "oauth2_password",
    clientId: oauth.password_client_id,
    clientSecret: oauth.password_client_secret,
    user: oauth.user,
    pass: oauth.pass,
    scope: oauth.scope,
  };
}

export function oauth2ClientCred(site: SiteName = "plain"): Auth {
  const oauth = oauth2Config(site);
  return {
    type: "oauth2_client_credentials",
    clientId: oauth.cc_client_id,
    clientSecret: oauth.cc_client_secret,
    scope: oauth.scope,
  };
}

export async function createTestNode(title: string, site: SiteName = "plain"): Promise<string> {
  const payload = { data: { type: "node--article_test", attributes: { title } } };
  const result = await runCli({
    site,
    args: ["create", "node", "--bundle=article_test", `--data=${JSON.stringify(payload)}`],
  });
  if (result.code !== 0) {
    throw new Error(`createTestNode failed: exit=${result.code} stderr=${result.stderr}`);
  }
  const body = parseJson<{ data: { id: string } }>(result.stdout);
  return body.data.id;
}
