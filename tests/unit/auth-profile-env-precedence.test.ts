import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setActive, writeProfile } from "../../src/core/auth/session-store.js";
import type { DropSHPlugin as Plugin } from "../../src/core/plugin.js";
import { authStatus, resolveAuth } from "../../src/index.js";

// Regression coverage for DROPSH-15: `$DROPSH_AUTH_PROFILE` must be honoured on the
// library path (a direct `resolveAuth`/`authStatus` call), at the precedence the README
// documents — an explicit `deps.profile` wins over the env var, and the env var wins over
// the stored active pointer. Today the env var is read only while the CLI program is built
// (`src/index.ts:224`), so a library consumer loses that precedence level entirely.

// A minimal echo provider that stamps the resolved profile's stored token into the
// Authorization header, so the returned adapter reveals which profile actually won.
function echoPlugin(id: string): Plugin {
  return {
    id,
    requiredModules: [],
    authProvider: {
      id,
      displayName: id,
      capabilities: { login: true, logout: true, status: true },
      async login() {
        return { access_token: `${id}-tok` };
      },
      async logout() {},
      async status(s: unknown) {
        return { loggedIn: s !== null, provider: id };
      },
      createAdapter(session: { access_token?: string } | undefined) {
        return {
          async apply(req: { headers?: Record<string, string> }) {
            return {
              ...req,
              headers: { ...(req.headers ?? {}), Authorization: `Bearer ${session?.access_token}` },
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

const BASE_URL = "https://example.com";
const base = {
  baseUrl: BASE_URL,
  http: {
    async send() {
      throw new Error("unused");
    },
  },
  now: () => 0,
};

// Two profiles configured, `pm` stored as the active pointer (`dropsh auth use pm`).
async function twoProfilesActivePm(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dropsh-envprofile-"));
  await writeProfile(BASE_URL, "session", "session", { access_token: "session-tok" }, dir);
  await writeProfile(BASE_URL, "pm", "pm", { access_token: "pm-tok" }, dir);
  await setActive(BASE_URL, "pm", dir);
  return dir;
}

describe("auth profile precedence — $DROPSH_AUTH_PROFILE on the library path (DROPSH-15)", () => {
  const savedEnv = process.env.DROPSH_AUTH_PROFILE;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.DROPSH_AUTH_PROFILE;
    else process.env.DROPSH_AUTH_PROFILE = savedEnv;
  });

  it("resolveAuth: the env var outranks the stored active pointer", async () => {
    const dir = await twoProfilesActivePm();
    process.env.DROPSH_AUTH_PROFILE = "session";
    const adapter = await resolveAuth({
      ...base,
      plugins: [echoPlugin("session"), echoPlugin("pm")],
      stateDir: dir,
    });
    const req = await adapter.apply({ method: "GET", url: "/x" });
    expect(req.headers?.Authorization).toBe("Bearer session-tok");
  });

  it("resolveAuth: an explicit deps.profile still wins over the env var", async () => {
    const dir = await twoProfilesActivePm();
    process.env.DROPSH_AUTH_PROFILE = "session";
    const adapter = await resolveAuth({
      ...base,
      plugins: [echoPlugin("session"), echoPlugin("pm")],
      stateDir: dir,
      profile: "pm",
    });
    const req = await adapter.apply({ method: "GET", url: "/x" });
    expect(req.headers?.Authorization).toBe("Bearer pm-tok");
  });

  it("authStatus: the env var outranks the stored active pointer", async () => {
    const dir = await twoProfilesActivePm();
    process.env.DROPSH_AUTH_PROFILE = "session";
    const st = await authStatus({
      baseUrl: BASE_URL,
      plugins: [echoPlugin("session"), echoPlugin("pm")],
      stateDir: dir,
    });
    expect(st.provider).toBe("session");
  });

  it("resolveAuth: a resolution failure names the chosen profile and its origin", async () => {
    const dir = await twoProfilesActivePm();
    process.env.DROPSH_AUTH_PROFILE = "ghost"; // env-chosen, no matching provider
    await expect(
      resolveAuth({
        ...base,
        plugins: [echoPlugin("session"), echoPlugin("pm")],
        stateDir: dir,
      }),
    ).rejects.toThrow(/auth profile 'ghost'.*\$DROPSH_AUTH_PROFILE/s);
  });
});
