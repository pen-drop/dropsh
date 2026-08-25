import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../../../src/core/http.js";
import { HttpError } from "../../../src/errors.js";

function mockFetch(responses: Array<{ status: number; body: string } | Error>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("unexpected call");
    if (r instanceof Error) throw r;
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("createHttpClient", () => {
  it("sends and returns parsed response on 2xx", async () => {
    const http = createHttpClient({
      fetch: mockFetch([{ status: 200, body: '{"ok":true}' }]),
    });
    const res = await http.send({ method: "GET", url: "https://x/y" });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it("retries on 503 up to maxRetries, then throws HttpError", async () => {
    const http = createHttpClient({
      fetch: mockFetch([
        { status: 503, body: "down" },
        { status: 503, body: "down" },
        { status: 503, body: "down" },
        { status: 503, body: "down" },
      ]),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    await expect(http.send({ method: "GET", url: "https://x/y" })).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it("retries on 503, then returns 200", async () => {
    const http = createHttpClient({
      fetch: mockFetch([
        { status: 503, body: "down" },
        { status: 200, body: '{"ok":true}' },
      ]),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    const res = await http.send({ method: "GET", url: "https://x/y" });
    expect(res.status).toBe(200);
  });

  it("does NOT retry on 4xx", async () => {
    const fetchMock = mockFetch([{ status: 422, body: '{"errors":[]}' }]);
    const http = createHttpClient({ fetch: fetchMock, maxRetries: 3, retryDelayMs: 0 });
    await expect(http.send({ method: "POST", url: "https://x/y" })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on thrown network error", async () => {
    const http = createHttpClient({
      fetch: mockFetch([new Error("ECONNRESET"), { status: 200, body: "{}" }]),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    const res = await http.send({ method: "GET", url: "https://x/y" });
    expect(res.status).toBe(200);
  });
});
