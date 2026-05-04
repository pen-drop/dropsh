import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildProgram } from "../../src/index.js";
import { createHttpClient } from "../../src/core/http.js";
import { createAuthAdapter } from "../../src/core/auth/factory.js";
import { createJsonApiClient } from "../../src/core/jsonapi/client.js";

describe("smoke: read command against fake Drupal", () => {
  let server: Server;
  let port = 0;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/jsonapi/node/article/abcdef01-abcd-abcd-abcd-abcdef012345") {
        res.writeHead(200, { "content-type": "application/vnd.api+json" });
        res.end('{"data":{"id":"abcdef01-abcd-abcd-abcd-abcdef012345","type":"node--article","attributes":{"title":"Hi"}}}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reads an article", async () => {
    const out: string[] = [];
    const http = createHttpClient({});
    const baseUrl = `http://127.0.0.1:${port}`;
    const auth = createAuthAdapter({ type: "basic", username: "a", password: "b" }, { http, baseUrl });
    const client = createJsonApiClient({ baseUrl, prefix: "/jsonapi", http, auth });
    const p = buildProgram({
      contextFactory: async () => ({ client, http, auth, baseUrl, jsonapiPrefix: "/jsonapi", cwd: process.cwd() }),
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    await p.parseAsync(["node", "drupal-cli", "read", "node/article/abcdef01-abcd-abcd-abcd-abcdef012345"]);
    const res = JSON.parse(out.join(""));
    expect(res.data.attributes.title).toBe("Hi");
  });
});
