import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type SiteName, testConfig } from "./config.js";

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
}

function renderConfig(url: string, auth: Auth): string {
  const schemataUrl = pathToFileURL(resolve("plugins/schemata/src/index.js")).href;
  const oauthUrl = pathToFileURL(resolve("plugins/oauth2/src/index.js")).href;
  const basicUrl = pathToFileURL(resolve("src/core/auth/basic.js")).href;
  const tokenUrl = `${url.replace(/\/$/, "")}/oauth/token`;

  if (auth.type === "basic") {
    return [
      `import { basicAuthPlugin } from ${JSON.stringify(basicUrl)};`,
      `import { schemataPlugin } from ${JSON.stringify(schemataUrl)};`,
      "",
      "export default {",
      `  site: { base_url: ${JSON.stringify(url)}, jsonapi_prefix: '/jsonapi' },`,
      "  defaults: { dry_run: false, timeout_ms: 30000 },",
      "  plugins: [",
      `    basicAuthPlugin({ username: ${JSON.stringify(auth.user)}, password: ${JSON.stringify(auth.pass)} }),`,
      "    schemataPlugin(),",
      "  ],",
      "};",
      "",
    ].join("\n");
  }

  if (auth.type === "oauth2_password") {
    return [
      `import { oauth2Plugin } from ${JSON.stringify(oauthUrl)};`,
      `import { schemataPlugin } from ${JSON.stringify(schemataUrl)};`,
      "",
      "export default {",
      `  site: { base_url: ${JSON.stringify(url)}, jsonapi_prefix: '/jsonapi' },`,
      "  defaults: { dry_run: false, timeout_ms: 30000 },",
      "  plugins: [",
      "    oauth2Plugin({",
      "      type: 'oauth2_password',",
      `      client_id: ${JSON.stringify(auth.clientId)},`,
      `      client_secret: ${JSON.stringify(auth.clientSecret)},`,
      `      username: ${JSON.stringify(auth.user)},`,
      `      password: ${JSON.stringify(auth.pass)},`,
      `      token_url: ${JSON.stringify(tokenUrl)},`,
      ...(auth.scope ? [`      scope: ${JSON.stringify(auth.scope)},`] : []),
      "    }),",
      "    schemataPlugin(),",
      "  ],",
      "};",
      "",
    ].join("\n");
  }

  // oauth2_client_credentials
  return [
    `import { oauth2Plugin } from ${JSON.stringify(oauthUrl)};`,
    `import { schemataPlugin } from ${JSON.stringify(schemataUrl)};`,
    "",
    "export default {",
    `  site: { base_url: ${JSON.stringify(url)}, jsonapi_prefix: '/jsonapi' },`,
    "  defaults: { dry_run: false, timeout_ms: 30000 },",
    "  plugins: [",
    "    oauth2Plugin({",
    "      type: 'oauth2_client_credentials',",
    `      client_id: ${JSON.stringify(auth.clientId)},`,
    `      client_secret: ${JSON.stringify(auth.clientSecret)},`,
    `      token_url: ${JSON.stringify(tokenUrl)},`,
    ...(auth.scope ? [`      scope: ${JSON.stringify(auth.scope)},`] : []),
    "    }),",
    "    schemataPlugin(),",
    "  ],",
    "};",
    "",
  ].join("\n");
}

export async function runCli(opts: RunOptions): Promise<RunResult> {
  const cfg = testConfig(opts.site ?? "plain");
  const url = opts.url ?? cfg.url;
  const auth = opts.auth ?? basicAuth(opts.site ?? "plain");

  const dir = mkdtempSync(join(tmpdir(), "dropsh-it-"));
  const cfgPath = join(dir, "dropsh.config.mjs");
  writeFileSync(cfgPath, renderConfig(url, auth), "utf8");

  return await new Promise<RunResult>((resolve) => {
    const child = spawn("node", ["--import", "tsx/esm", "bin/dropsh-src", ...opts.args], {
      env: {
        ...process.env,
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
  const cfg = testConfig(site);
  return {
    type: "oauth2_password",
    clientId: cfg.oauth2.password_client_id,
    clientSecret: cfg.oauth2.password_client_secret,
    user: cfg.oauth2.user,
    pass: cfg.oauth2.pass,
    scope: cfg.oauth2.scope,
  };
}

export function oauth2ClientCred(site: SiteName = "plain"): Auth {
  const cfg = testConfig(site);
  return {
    type: "oauth2_client_credentials",
    clientId: cfg.oauth2.cc_client_id,
    clientSecret: cfg.oauth2.cc_client_secret,
    scope: cfg.oauth2.scope,
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
