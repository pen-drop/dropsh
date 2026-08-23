import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { basicAuthPlugin } from "../../src/core/auth/basic.js";
import { readProfile, writeProfile, writeSession } from "../../src/core/auth/session-store.js";
import type { JsonApiClient } from "../../src/core/jsonapi/client.js";
import type { DropSHPlugin, DropSHPlugin as Plugin } from "../../src/core/plugin.js";
import { toOperationVariant } from "../../src/core/schema/to-jsonschema.js";
import {
  authStatus,
  buildProgram,
  type CommandContext,
  normalizeInclude,
  resolveAuth,
} from "../../src/index.js";

function fakeClient(): JsonApiClient {
  return {
    get: vi.fn(async () => ({ data: { type: "node--article", id: "u1" } })),
    post: vi.fn(async () => ({ data: { type: "node--article", id: "u2" } })),
    patch: vi.fn(async () => ({ data: { type: "node--article", id: "u1" } })),
    delete: vi.fn(async () => ({ ok: true as const })),
    upload: vi.fn(async () => ({ data: { type: "file--file", id: "file" } })),
    collection: vi.fn(),
    resource: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    me: vi.fn(),
  };
}

describe("normalizeInclude", () => {
  it("returns an empty array for undefined", () => {
    expect(normalizeInclude(undefined)).toEqual([]);
  });

  it("passes through a plain variadic list", () => {
    expect(normalizeInclude(["field_related", "field_image"])).toEqual([
      "field_related",
      "field_image",
    ]);
  });

  it("splits comma-separated entries and trims whitespace", () => {
    expect(normalizeInclude(["field_related, field_image", " field_tags "])).toEqual([
      "field_related",
      "field_image",
      "field_tags",
    ]);
  });

  it("drops empty strings produced by trailing commas or blanks", () => {
    expect(normalizeInclude(["field_related,,", "  ", ""])).toEqual(["field_related"]);
  });
});

describe("buildProgram", () => {
  it("registers all subcommands", () => {
    const p = buildProgram({
      contextFactory: async () =>
        ({ client: fakeClient(), plugins: [] }) as unknown as CommandContext,
    });
    const names = p.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      "auth",
      "create",
      "delete",
      "read",
      "schema",
      "search",
      "update",
      "upload-file",
    ]);
  });

  it("read subcommand runs via parseAsync and writes JSON to stdout", async () => {
    const c = fakeClient();
    const out: string[] = [];
    const err: string[] = [];
    const p = buildProgram({
      contextFactory: async () => ({ client: c, plugins: [] }) as unknown as CommandContext,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "read",
      "node/article/abcdef01-abcd-abcd-abcd-abcdef012345",
    ]);
    expect(c.get).toHaveBeenCalledWith("node/article/abcdef01-abcd-abcd-abcd-abcdef012345");
    expect(JSON.parse(out.join(""))).toEqual({ data: { type: "node--article", id: "u1" } });
  });

  it("read subcommand forwards --include as JSON:API params", async () => {
    const c = fakeClient();
    const p = buildProgram({
      contextFactory: async () => ({ client: c, plugins: [] }) as unknown as CommandContext,
      stdout: () => {},
      stderr: () => {},
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "read",
      "node/article/abcdef01-abcd-abcd-abcd-abcdef012345",
      "--include",
      "field_related,field_image",
    ]);
    const [target, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(target).toBe("node/article/abcdef01-abcd-abcd-abcd-abcdef012345");
    expect(params.getQueryString({ encode: false })).toBe("include=field_related,field_image");
  });

  it("search subcommand forwards --include alongside filters and limit", async () => {
    const c = fakeClient();
    const p = buildProgram({
      contextFactory: async () => ({ client: c, plugins: [] }) as unknown as CommandContext,
      stdout: () => {},
      stderr: () => {},
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "search",
      "node",
      "--bundle",
      "article",
      "--include",
      "field_related",
      "field_image",
    ]);
    const [path, params] = (c.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe("node/article");
    expect(params.getQueryString({ encode: false })).toBe(
      "include=field_related,field_image&page[limit]=50",
    );
  });

  it("propagates ValidationError to stderr with exit-code signal", async () => {
    const err: string[] = [];
    const exitCodes: number[] = [];
    const p = buildProgram({
      contextFactory: async () =>
        ({ client: fakeClient(), plugins: [] }) as unknown as CommandContext,
      stdout: () => {},
      stderr: (s) => err.push(s),
      setExitCode: (code) => exitCodes.push(code),
    });
    await p.parseAsync(["node", "dropsh", "read", "bad"]);
    const parsed = JSON.parse(err.join(""));
    expect(parsed.error.code).toBe("E_VALIDATION");
    expect(exitCodes).toContain(4);
  });

  it("calls registerCommands on plugins passed to buildProgram", () => {
    const registeredCommands: string[] = [];
    const plugin: DropSHPlugin = {
      id: "test-cmd",
      requiredModules: [],
      registerCommands(program) {
        program
          .command("test-plugin-cmd")
          .description("test")
          .action(() => {});
        registeredCommands.push("test-plugin-cmd");
      },
      async extendSchema(_e, _b, s) {
        return s;
      },
    };
    const p = buildProgram({ plugins: [plugin] });
    const names = p.commands.map((c) => c.name());
    expect(names).toContain("test-plugin-cmd");
    expect(registeredCommands).toEqual(["test-plugin-cmd"]);
  });

  it("resolveAuth builds an adapter from the stored session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const b64 = Buffer.from("u:p").toString("base64");
    await writeSession("https://example.com", "basic", { basic_b64: b64 }, dir);
    const adapter = await resolveAuth({
      baseUrl: "https://example.com",
      plugins: [basicAuthPlugin()],
      http: {
        async send() {
          throw new Error("unused");
        },
      },
      now: () => 0,
      stateDir: dir,
    });
    const req = await adapter.apply({ method: "GET", url: "https://x" });
    expect(req.headers?.Authorization).toBe(`Basic ${b64}`);
  });

  it("resolveAuth throws AuthError when there is no session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    await expect(
      resolveAuth({
        baseUrl: "https://example.com",
        plugins: [basicAuthPlugin()],
        http: {
          async send() {
            throw new Error("unused");
          },
        },
        now: () => 0,
        stateDir: dir,
      }),
    ).rejects.toThrow(/auth login/);
  });

  it("resolveAuth serves a session-less provider with no stored session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const b64 = Buffer.from("u:p").toString("base64");
    const sessionlessPlugin = {
      id: "static-basic",
      requiredModules: [],
      authProvider: {
        id: "static-basic",
        displayName: "Static Basic",
        capabilities: { login: false, logout: false, status: false },
        async login() {
          return {};
        },
        async logout() {},
        async status() {
          return { loggedIn: true };
        },
        createAdapter(_session: unknown) {
          return {
            async apply(req: { method: string; url: string; headers: Record<string, string> }) {
              return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${b64}` } };
            },
          };
        },
      },
    };
    const adapter = await resolveAuth({
      baseUrl: "https://example.com",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: [sessionlessPlugin as any],
      http: { send: vi.fn() },
      now: () => 0,
      stateDir: dir, // empty dir → no session record
    });
    const out = await adapter.apply({ method: "GET", url: "/x", headers: {} });
    expect(out.headers?.Authorization).toBe(`Basic ${b64}`);
  });

  it("resolveAuth still throws for a login-capable provider with no session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const loginCapable = {
      id: "oauth",
      requiredModules: [],
      authProvider: {
        id: "oauth",
        displayName: "OAuth",
        capabilities: { login: true, logout: true, status: true },
        async login() {
          return {};
        },
        async logout() {},
        async status() {
          return { loggedIn: false };
        },
        createAdapter() {
          return {
            async apply(r: unknown) {
              return r;
            },
          };
        },
      },
    };
    await expect(
      resolveAuth({
        baseUrl: "https://example.com",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: [loginCapable as any],
        http: { send: vi.fn() },
        now: () => 0,
        stateDir: dir,
      }),
    ).rejects.toThrow("Not authenticated");
  });
});

describe("resolveAuth — named profiles", () => {
  // A minimal echo provider that stamps its own id into the Authorization header
  // and re-mints (bumps the token) on save, so we can observe per-profile isolation.
  function echoPlugin(id: string, isDefault = false): Plugin {
    return {
      id,
      requiredModules: [],
      authProvider: {
        id,
        displayName: id,
        ...(isDefault ? { default: true } : {}),
        capabilities: { login: true, logout: true, status: true },
        async login() {
          return { access_token: `${id}-tok` };
        },
        async logout() {},
        async status(s: unknown) {
          return { loggedIn: s !== null, provider: id };
        },
        createAdapter(
          session: { access_token?: string } | undefined,
          rt: { save: (s: unknown) => Promise<void> },
        ) {
          return {
            async apply(req: { headers?: Record<string, string> }) {
              await rt.save({ access_token: `${id}-renewed` });
              return {
                ...req,
                headers: {
                  ...(req.headers ?? {}),
                  Authorization: `Bearer ${session?.access_token}`,
                },
              };
            },
          };
        },
      },
      async extendSchema(_e: unknown, _b: unknown, s: unknown) {
        return s;
      },
    } as unknown as Plugin;
  }

  const base = {
    baseUrl: "https://example.com",
    http: {
      async send() {
        throw new Error("unused");
      },
    },
    now: () => 0,
  };

  it("explicit profile wins over the stored active pointer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    await writeProfile(
      "https://example.com",
      "session",
      "session",
      { access_token: "session-tok" },
      dir,
    );
    await writeProfile("https://example.com", "pm", "pm", { access_token: "pm-tok" }, dir);
    const { setActive } = await import("../../src/core/auth/session-store.js");
    await setActive("https://example.com", "session", dir);
    const adapter = await resolveAuth({
      ...base,
      plugins: [echoPlugin("session"), echoPlugin("pm")],
      stateDir: dir,
      profile: "pm",
    });
    const req = await adapter.apply({ method: "GET", url: "/x" });
    expect(req.headers?.Authorization).toBe("Bearer pm-tok");
  });

  it("falls back to config default:true when nothing is active", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    await writeProfile(
      "https://example.com",
      "session",
      "session",
      { access_token: "session-tok" },
      dir,
    );
    await writeProfile("https://example.com", "pm", "pm", { access_token: "pm-tok" }, dir);
    const adapter = await resolveAuth({
      ...base,
      plugins: [echoPlugin("session", true), echoPlugin("pm")],
      stateDir: dir,
    });
    const req = await adapter.apply({ method: "GET", url: "/x" });
    expect(req.headers?.Authorization).toBe("Bearer session-tok");
  });

  it("throws when multiple profiles exist but none is active/default/selected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    await expect(
      resolveAuth({ ...base, plugins: [echoPlugin("session"), echoPlugin("pm")], stateDir: dir }),
    ).rejects.toThrow(/none active/);
  });

  it("renews only the resolved profile's slot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    await writeProfile(
      "https://example.com",
      "session",
      "session",
      { access_token: "session-tok" },
      dir,
    );
    await writeProfile("https://example.com", "pm", "pm", { access_token: "pm-tok" }, dir);
    const adapter = await resolveAuth({
      ...base,
      plugins: [echoPlugin("session"), echoPlugin("pm")],
      stateDir: dir,
      profile: "pm",
    });
    await adapter.apply({ method: "GET", url: "/x" });
    expect((await readProfile("https://example.com", "pm", dir))?.session.access_token).toBe(
      "pm-renewed",
    );
    expect((await readProfile("https://example.com", "session", dir))?.session.access_token).toBe(
      "session-tok",
    );
  });
});

describe("authStatus", () => {
  it("reports a session-less provider as logged in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const b64 = Buffer.from("u:p").toString("base64");
    const sessionlessPlugin = {
      id: "static-basic",
      requiredModules: [],
      authProvider: {
        id: "static-basic",
        displayName: "Static Basic",
        capabilities: { login: false, logout: false, status: false },
        async login() {
          return {};
        },
        async logout() {},
        async status() {
          return { loggedIn: true };
        },
        createAdapter() {
          return {
            async apply(req: { method: string; url: string; headers: Record<string, string> }) {
              return { ...req, headers: { ...(req.headers ?? {}), Authorization: `Basic ${b64}` } };
            },
          };
        },
      },
    };
    const st = await authStatus({
      baseUrl: "https://example.com",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: [sessionlessPlugin as any],
      stateDir: dir,
    });
    expect(st.loggedIn).toBe(true);
    expect(st.sessionless).toBe(true);
  });

  it("reports not-logged-in for a login-capable provider with no session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const loginCapable = {
      id: "oauth",
      requiredModules: [],
      authProvider: {
        id: "oauth",
        displayName: "OAuth",
        capabilities: { login: true, logout: true, status: true },
        async login() {
          return {};
        },
        async logout() {},
        async status() {
          return { loggedIn: false };
        },
        createAdapter() {
          return {
            async apply(r: unknown) {
              return r;
            },
          };
        },
      },
    };
    const st = await authStatus({
      baseUrl: "https://example.com",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: [loginCapable as any],
      stateDir: dir,
    });
    expect(st.loggedIn).toBe(false);
  });

  it("delegates to provider.status when a session exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dropsh-test-"));
    const b64 = Buffer.from("u:p").toString("base64");
    await writeSession("https://example.com", "basic", { basic_b64: b64 }, dir);
    const st = await authStatus({
      baseUrl: "https://example.com",
      plugins: [basicAuthPlugin()],
      stateDir: dir,
    });
    expect(st.loggedIn).toBe(true);
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const RICH_RAW = JSON.parse(
  readFileSync(join(here, "fixtures/schemata/node--article.rich.schema.json"), "utf8"),
) as unknown;

/** Mirrors siteCacheRoot()/loadOrFetchSchema() for baseUrl "https://ex". */
function seedSchema(cwd: string, op: "create" | "update", hookPlugins: string[] = []): void {
  const abs = join(cwd, ".dropsh/cache", "ex", "schema", `node--article.${op}.json`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    JSON.stringify({
      ...(toOperationVariant(RICH_RAW, op) as Record<string, unknown>),
      "x-dropsh-schema-pipeline-version": 2,
      "x-dropsh-operation-hook-plugins": hookPlugins,
    }),
    "utf8",
  );
}

function paramContext(cwd: string, client: JsonApiClient, plugins: DropSHPlugin[] = []) {
  return {
    client,
    http: {
      send: vi.fn(async () => {
        throw new Error("no HTTP expected");
      }),
    },
    auth: { apply: async (req: unknown) => req },
    baseUrl: "https://ex",
    jsonapiPrefix: "/jsonapi",
    cwd,
    plugins,
  } as unknown as CommandContext;
}

describe("create with field parameters", () => {
  it("AC 1: builds and POSTs a document from named parameters", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node",
      "dropsh",
      "create",
      "node",
      "--bundle",
      "article",
      "--title",
      "Test",
      "--body.value",
      "Text",
    ]);
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Test", body: { value: "Text" } } },
    });
  });

  it("AC 6: --dry-run prints the built document and sends nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    const out: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: (s) => out.push(s),
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "create",
      "node",
      "--bundle",
      "article",
      "--title",
      "T",
      "--dry-run",
    ]);
    expect(c.post).not.toHaveBeenCalled();
    expect(c.patch).not.toHaveBeenCalled();
    expect(JSON.parse(out.join(""))).toEqual({
      dry_run: true,
      method: "POST",
      path: "node/article",
      payload: { data: { type: "node--article", attributes: { title: "T" } } },
    });
  });

  it("AC 3: exits 4 on an unknown parameter and sends nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    let code: number | undefined;
    const errs: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: () => {},
      stderr: (s) => errs.push(s),
      setExitCode: (n) => {
        code = n;
      },
    });
    await p.parseAsync(["node", "dropsh", "create", "node", "--bundle", "article", "--titel", "T"]);
    expect(code).toBe(4);
    expect(errs.join("")).toMatch(/unknown parameter 'titel'/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("rejects --data together with field parameters", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    let code: number | undefined;
    const errs: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: () => {},
      stderr: (s) => errs.push(s),
      setExitCode: (n) => {
        code = n;
      },
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "create",
      "node",
      "--bundle",
      "article",
      "--data",
      "{}",
      "--title",
      "T",
    ]);
    expect(code).toBe(4);
    expect(errs.join("")).toMatch(/mutually exclusive/);
    expect(c.post).not.toHaveBeenCalled();
  });

  it("AC 9: --data alone still sends the identical payload", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node",
      "dropsh",
      "create",
      "node",
      "--bundle",
      "article",
      "--no-validate",
      "--data",
      '{"data":{"type":"node--article","attributes":{"title":"Raw"}}}',
    ]);
    expect(c.post).toHaveBeenCalledWith("node/article", {
      data: { type: "node--article", attributes: { title: "Raw" } },
    });
  });
});

describe("update with field parameters", () => {
  const uuid = "11111111-2222-3333-4444-555555555555";

  it("AC 8: builds a PATCH document with data.id and only the supplied fields", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "update");
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node",
      "dropsh",
      "update",
      `node/article/${uuid}`,
      "--title",
      "New title",
    ]);
    expect(c.patch).toHaveBeenCalledWith(`node/article/${uuid}`, {
      data: { type: "node--article", id: uuid, attributes: { title: "New title" } },
    });
  });

  it("AC 4: takes a relationship as a bare UUID on update", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "update");
    const c = fakeClient();
    const p = buildProgram({ contextFactory: async () => paramContext(cwd, c), stdout: () => {} });
    await p.parseAsync([
      "node",
      "dropsh",
      "update",
      `node/article/${uuid}`,
      "--uid",
      "123e4567-e89b-12d3-a456-426614174000",
    ]);
    expect(c.patch).toHaveBeenCalledWith(`node/article/${uuid}`, {
      data: {
        type: "node--article",
        id: uuid,
        relationships: {
          uid: { data: { type: "user--user", id: "123e4567-e89b-12d3-a456-426614174000" } },
        },
      },
    });
  });
});

describe("--fields lists the bundle's parameters", () => {
  it("prints a readable table and sends nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    const out: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: (s) => out.push(s),
    });
    await p.parseAsync(["node", "dropsh", "create", "node", "--bundle", "article", "--fields"]);
    expect(c.post).not.toHaveBeenCalled();
    expect(c.patch).not.toHaveBeenCalled();
    const text = out.join("");
    expect(text).toMatch(/node--article — field parameters/);
    expect(text).toMatch(/--title <value>\s+string\s+required/);
    expect(text).toMatch(/--body\.value <value>/);
    expect(text).toMatch(/--uid <uuid>\s+user--user/);
    expect(text).not.toMatch(/^\{/);
  });

  it("hands back JSON on an explicit --format json", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "create");
    const c = fakeClient();
    const out: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: (s) => out.push(s),
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "--format",
      "json",
      "create",
      "node",
      "--bundle",
      "article",
      "--fields",
    ]);
    expect(c.post).not.toHaveBeenCalled();
    const listed = JSON.parse(out.join("")) as {
      type: string;
      attributes: Array<{ path: string }>;
      relationships: Array<{ path: string; targets: string[] }>;
    };
    expect(listed.type).toBe("node--article");
    expect(listed.attributes.map((a) => a.path)).toContain("body.value");
    expect(listed.relationships.find((r) => r.path === "uid")?.targets).toEqual(["user--user"]);
  });

  it("works on update too, without patching", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dropsh-params-"));
    seedSchema(cwd, "update");
    const c = fakeClient();
    const out: string[] = [];
    const p = buildProgram({
      contextFactory: async () => paramContext(cwd, c),
      stdout: (s) => out.push(s),
    });
    await p.parseAsync([
      "node",
      "dropsh",
      "update",
      "node/article/11111111-2222-3333-4444-555555555555",
      "--fields",
    ]);
    expect(c.patch).not.toHaveBeenCalled();
    expect(out.join("")).toMatch(/node--article — field parameters/);
  });
});
