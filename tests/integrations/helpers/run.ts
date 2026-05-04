import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testConfig } from "./config.js";

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
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export interface RunOptions {
  url?: string;
  auth?: Auth;
  args: string[];
}

function renderConfig(url: string, auth: Auth): string {
  const lines = ["site:", `  base_url: ${url}`, "  jsonapi_prefix: /jsonapi", "  auth:"];
  if (auth.type === "basic") {
    lines.push("    type: basic", `    username: ${auth.user}`, `    password: ${auth.pass}`);
  } else if (auth.type === "oauth2_password") {
    lines.push(
      "    type: oauth2_password",
      `    client_id: ${auth.clientId}`,
      `    client_secret: ${auth.clientSecret}`,
      `    username: ${auth.user}`,
      `    password: ${auth.pass}`,
    );
    if (auth.scope) lines.push(`    scope: ${auth.scope}`);
  } else {
    lines.push(
      "    type: oauth2_client_credentials",
      `    client_id: ${auth.clientId}`,
      `    client_secret: ${auth.clientSecret}`,
    );
    if (auth.scope) lines.push(`    scope: ${auth.scope}`);
  }
  lines.push("defaults:", "  dry_run: false", "  timeout_ms: 30000");
  return `${lines.join("\n")}\n`;
}

export async function runCli(opts: RunOptions): Promise<RunResult> {
  const cfg = testConfig();
  const url = opts.url ?? cfg.url;
  const auth = opts.auth ?? basicAuth();

  const dir = mkdtempSync(join(tmpdir(), "drupal-cli-it-"));
  const cfgPath = join(dir, ".drupal-cli.yml");
  writeFileSync(cfgPath, renderConfig(url, auth), "utf8");

  return await new Promise<RunResult>((resolve) => {
    const child = spawn("node", ["bin/drupal-cli", ...opts.args], {
      env: {
        ...process.env,
        DRUPAL_CLI_CONFIG: cfgPath,
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

export function basicAuth(): Auth {
  const cfg = testConfig();
  return { type: "basic", user: cfg.basic.user, pass: cfg.basic.pass };
}

export function oauth2Password(): Auth {
  const cfg = testConfig();
  return {
    type: "oauth2_password",
    clientId: cfg.oauth2.password_client_id,
    clientSecret: cfg.oauth2.password_client_secret,
    user: cfg.oauth2.user,
    pass: cfg.oauth2.pass,
    scope: cfg.oauth2.scope,
  };
}

export function oauth2ClientCred(): Auth {
  const cfg = testConfig();
  return {
    type: "oauth2_client_credentials",
    clientId: cfg.oauth2.cc_client_id,
    clientSecret: cfg.oauth2.cc_client_secret,
    scope: cfg.oauth2.scope,
  };
}

export async function createTestNode(title: string): Promise<string> {
  const payload = {
    data: {
      type: "node--article_test",
      attributes: { title },
    },
  };

  const result = await runCli({
    args: ["create", "node", "--bundle=article_test", `--data=${JSON.stringify(payload)}`],
  });
  if (result.code !== 0) {
    throw new Error(`createTestNode failed: exit=${result.code} stderr=${result.stderr}`);
  }

  const body = parseJson<{ data: { id: string } }>(result.stdout);
  return body.data.id;
}
