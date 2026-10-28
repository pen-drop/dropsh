import type { AuthAdapter, HttpRequest } from "dropsh/plugin";

/**
 * A fetch for the MCP SDK transport that authorises every request through the
 * connection's AuthAdapter. It never retries: tools are often not idempotent.
 * The only re-send follows a 401 after a successful `auth.renew()`, which the
 * server rejected before running anything.
 */
export function authFetch(auth: AuthAdapter, base: typeof fetch = fetch): typeof fetch {
  async function send(url: string | URL | Request, init: RequestInit): Promise<Response> {
    const req = await auth.apply({
      method: (init.method ?? "GET") as HttpRequest["method"],
      url: String(url),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return base(url, { ...init, headers: req.headers ?? {} });
  }

  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    const res = await send(url, init);
    if (res.status !== 401 || !auth.renew) return res;
    const outcome = await auth.renew();
    if (!outcome.ok) {
      if (outcome.cause !== undefined) throw outcome.cause;
      return res;
    }
    await res.body?.cancel();
    return send(url, init);
  }) as typeof fetch;
}
