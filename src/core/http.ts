import { HttpError } from "../errors.js";

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

export interface HttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

const RETRY_STATUSES = new Set([502, 503, 504, 408, 429]);

export function createHttpClient(opts: HttpOptions = {}): HttpClient {
  const f = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 300;

  async function attempt(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
    try {
      const init: RequestInit = {
        method: req.method,
        signal: controller.signal,
      };
      if (req.headers !== undefined) init.headers = req.headers;
      if (req.body !== undefined) init.body = req.body;
      const res = await f(req.url, init);
      const text = await res.text();
      const headers: Record<string, string> = {};
      for (const [k, v] of res.headers.entries()) headers[k] = v;
      return { status: res.status, headers, body: text };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }

  return {
    async send(req: HttpRequest): Promise<HttpResponse> {
      let lastErr: unknown = null;
      for (let attemptIdx = 0; attemptIdx <= maxRetries; attemptIdx++) {
        try {
          const res = await attempt(req);
          if (res.status >= 200 && res.status < 300) return res;
          if (!RETRY_STATUSES.has(res.status) || attemptIdx === maxRetries) {
            let parsedBody: unknown = res.body;
            try {
              parsedBody = JSON.parse(res.body);
            } catch {
              /* keep text */
            }
            throw new HttpError(res.status, `HTTP ${res.status}`, parsedBody);
          }
        } catch (err) {
          if (err instanceof HttpError) throw err;
          lastErr = err;
          if (attemptIdx === maxRetries) break;
        }
        await sleep(retryDelayMs * 2 ** attemptIdx);
      }
      throw new HttpError(0, `Network failure after ${maxRetries + 1} attempts`, {
        cause: String(lastErr),
      });
    },
  };
}
