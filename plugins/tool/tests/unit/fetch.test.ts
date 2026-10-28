import { type AuthAdapter, AuthError } from "dropsh/plugin";
import { describe, expect, it, vi } from "vitest";
import { authFetch } from "../../src/fetch.js";

function bearer(getToken: () => string, renew?: AuthAdapter["renew"]): AuthAdapter {
  return {
    apply: async (req) => ({
      ...req,
      headers: { ...req.headers, Authorization: `Bearer ${getToken()}` },
    }),
    ...(renew ? { renew } : {}),
  };
}

function stubFetch(statuses: number[]) {
  const seen: Array<{ url: string; auth: string | null; body: unknown }> = [];
  const f = vi.fn(async (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: String(url),
      auth: new Headers(init?.headers).get("authorization"),
      body: init?.body,
    });
    return new Response("x", { status: statuses.shift() ?? 200 });
  });
  return { f: f as unknown as typeof fetch, seen };
}

describe("authFetch", () => {
  it("applies the adapter's credentials and keeps other headers and body", async () => {
    const { f, seen } = stubFetch([200]);
    const res = await authFetch(
      bearer(() => "t1"),
      f,
    )("http://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ url: "http://x/mcp", auth: "Bearer t1", body: "{}" }]);
  });

  it("re-sends exactly once with the renewed credentials after a 401", async () => {
    let token = "old";
    const renew = vi.fn(async () => {
      token = "new";
      return { ok: true as const };
    });
    const { f, seen } = stubFetch([401, 200]);
    const res = await authFetch(
      bearer(() => token, renew),
      f,
    )("http://x/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(seen.map((s) => s.auth)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("surfaces the renewal cause when renewal fails", async () => {
    const cause = new AuthError("refresh token expired");
    const { f, seen } = stubFetch([401]);
    await expect(
      authFetch(
        bearer(
          () => "t",
          async () => ({ ok: false, cause }),
        ),
        f,
      )("http://x/mcp", { method: "POST" }),
    ).rejects.toBe(cause);
    expect(seen).toHaveLength(1);
  });

  it("returns a 401 unchanged when the adapter cannot renew", async () => {
    const { f, seen } = stubFetch([401]);
    const res = await authFetch(
      bearer(() => "t"),
      f,
    )("http://x/mcp", { method: "POST" });
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(1);
  });

  it("never re-sends on a 502", async () => {
    const renew = vi.fn(async () => ({ ok: true as const }));
    const { f, seen } = stubFetch([502, 200]);
    const res = await authFetch(
      bearer(() => "t", renew),
      f,
    )("http://x/mcp", { method: "POST" });
    expect(res.status).toBe(502);
    expect(seen).toHaveLength(1);
    expect(renew).not.toHaveBeenCalled();
  });
});
