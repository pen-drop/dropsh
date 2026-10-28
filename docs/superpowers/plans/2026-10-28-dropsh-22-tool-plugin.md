# `@dropsh/plugin-tool` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new dropsh plugin that lists, describes and calls Drupal Tool API tools over Drupal's `mcp_server` endpoint, from the CLI (`dropsh tool`) and as a library (`createToolClient`).

**Architecture:** `plugins/tool` is an MCP *client* built on `@modelcontextprotocol/sdk` (`Client` + `StreamableHTTPClientTransport`). The transport gets a `fetch` wrapper that authorises each request through the connection's `AuthAdapter` and never retries. Arguments are validated with dropsh's `validatePayload` against the tool's `inputSchema` before `tools/call`. The CLI command is registered via the existing `registerCommands` plugin hook.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` 1.32.1, commander (via dropsh), Ajv (via `validatePayload`), vitest; Drupal 11 integration fixture with `tool`, `tool_belt`, `mcp_server`, `mcp_server_tool_bridge`, `mcp_server_oauth`.

**Spec:** `docs/superpowers/specs/2026-10-28-dropsh-22-tool-plugin-design.md`

## Global Constraints

- No breaking change: nothing outside `plugins/tool`, the integration fixture and docs changes behaviour; the only core edit is one additive export (`exitCodeFor`) in `src/plugin-api.ts`. `plugins/mcp` is untouched.
- The MCP SDK is a dependency of `plugins/tool` only, pinned to `1.32.1` (same as `plugins/mcp`); never of the root `dropsh` package.
- Default endpoint `/mcp`, appended to `baseUrl` (not under `jsonapi_prefix`); overridable by plugin option `endpoint`.
- No automatic retries; the only re-send is one after a 401 when `auth.renew()` returns `{ ok: true }`.
- Validation before every `tools/call`; no opt-out flag.
- All artifacts in English (CLAUDE.md).
- Before every commit: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`.

## Review Focus

1. **Tool name not found** — `dropsh tool nope` must fail with `ValidationError` (exit 4) listing up to five closest names, not a raw JSON-RPC error. Test in Task 3.
2. **`--param` for a property the schema does not declare** — kept as a string and then rejected by validation only if the schema forbids extra properties (`additionalProperties: false`); never silently dropped. Test in Task 3.
3. **Server returns 401 and renewal fails** — the renewal `cause` is surfaced (exit 3), not the bare 401. Test in Task 1.
4. **Basic-auth profile against stock `mcp_server`** — 403 error message names `access mcp server` and `mcp_server_oauth`. Test in Task 2.
5. **Tool with no `inputSchema` properties** (`{ type: "object" }`) — call with no arguments sends `{}` and succeeds. Test in Task 2.

---

## File structure

```
plugins/tool/
  package.json            # @dropsh/plugin-tool, deps: @modelcontextprotocol/sdk 1.32.1
  tsconfig.json           # copy of plugins/mcp/tsconfig.json
  vitest.config.ts        # copy of plugins/mcp/vitest.config.ts
  README.md
  src/index.ts            # toolPlugin(raw), re-exports createToolClient + types
  src/options.ts          # parseToolOptions(raw) -> { endpoint }
  src/fetch.ts            # authFetch(auth): typeof fetch  (auth.apply, 401 -> renew once)
  src/client.ts           # createToolClient(), ToolClient, ToolInfo, ToolCallError
  src/args.ts             # buildArguments(schema, data, params)
  src/command.ts          # registerToolCommand(program, services, options)
  tests/unit/helpers/server.ts   # in-process SDK McpServer on loopback for tests
  tests/unit/*.test.ts
src/plugin-api.ts         # + export { exitCodeFor }
tests/integrations/bin/init-tools.sh
tests/integrations/drupal/fixtures/setup-tools.php
tests/integrations/drupal/composer.json (+ lock)
tests/integrations/drupal/sites-templates/sites.php
tests/integrations/bin/drupal-up.sh, drupal-down.sh
tests/integrations/helpers/config.ts, run.ts
tests/integrations/tool.test.ts
.github/workflows/validate.yml  # add "tool" to the test-plugins matrix
```

---

### Task 1: Package scaffold, authorised fetch, `createToolClient().list/get/close`

**Files:**
- Create: `plugins/tool/{package.json,tsconfig.json,vitest.config.ts}`, `plugins/tool/src/{options.ts,fetch.ts,client.ts,index.ts}`, `plugins/tool/tests/unit/helpers/server.ts`, `plugins/tool/tests/unit/{fetch,client-list,options}.test.ts`
- Modify: `.github/workflows/validate.yml:62` (add `"tool"` to `plugin:`)

**Interfaces:**
- Produces:
  - `parseToolOptions(raw: unknown): { endpoint: string }` — default `"/mcp"`; non-string or not starting with `/` → `ConfigError`.
  - `authFetch(auth: AuthAdapter, base?: typeof fetch): typeof fetch`
  - `interface ToolInfo { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }`
  - `interface ToolClientOptions { auth: AuthAdapter; baseUrl: string; endpoint?: string; fetch?: typeof fetch }`
  - `interface ToolClient { list(): Promise<ToolInfo[]>; get(name: string): Promise<ToolInfo | undefined>; call(name: string, args: Record<string, unknown>): Promise<CallToolResult>; close(): Promise<void> }` (`call` implemented in Task 2)
  - `createToolClient(opts: ToolClientOptions): ToolClient`
- Test helper: `startTestMcpServer(tools: TestTool[], opts?: { requireBearer?: string; failFirstWith?: number }): Promise<{ url: string; calls: Array<{ name: string; args: unknown }>; seenAuth: string[]; close(): Promise<void> }>` — an SDK `McpServer` + `StreamableHTTPServerTransport` on `127.0.0.1:0`, same approach as `plugins/mcp/src/transports.ts`; supports a page size so pagination can be exercised.

- [ ] **Step 1: Write failing tests**
  - `options.test.ts`: `parseToolOptions(undefined)` → `{ endpoint: "/mcp" }`; `{ endpoint: "/api/mcp" }` kept; `{ endpoint: 5 }` and `{ endpoint: "mcp" }` throw `ConfigError`.
  - `fetch.test.ts`: `authFetch` sends the header produced by `auth.apply`; on 401 with `renew` → `{ ok: true }` re-sends exactly once with the new header; with `{ ok: false, cause }` rejects with `cause` (Review Focus 3); on 502 does **not** re-send (call count 1).
  - `client-list.test.ts`: server with 7 tools and page size 3 → `list()` returns 7 `ToolInfo` in server order; second `list()` makes no new `tools/list` request; `get("t3")` returns it, `get("nope")` → `undefined`; every request carried `Authorization: Bearer test`; `close()` resolves and a later `list()` re-initialises.
- [ ] **Step 2: Run** `cd plugins/tool && pnpm vitest run` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the four source files. `createToolClient` connects lazily (`Client.connect(new StreamableHTTPClientTransport(new URL(endpoint, baseUrl), { fetch: authFetch(auth, opts.fetch) }))`), loops `listTools({ cursor })` until `nextCursor` is absent, caches the array until `close()`. `index.ts` exports `toolPlugin` (stub returning `{ id: "tool", requiredModules: [] }` until Task 3), `createToolClient`, `parseToolOptions` and the types.
- [ ] **Step 4: Run** `cd plugins/tool && pnpm vitest run` — Expected: PASS. Then `pnpm run lint && pnpm run typecheck && pnpm test` from the root — PASS.
- [ ] **Step 5: Commit** `feat(tool): MCP tool client with authorised, non-retrying transport`

### Task 2: `call()` — validation before send, results and error mapping

**Files:**
- Modify: `plugins/tool/src/client.ts`
- Test: `plugins/tool/tests/unit/client-call.test.ts`

**Interfaces:**
- Consumes: Task 1 `createToolClient`, `ToolInfo`, `startTestMcpServer`.
- Produces:
  - `class ToolCallError extends CliError` — `code: "E_TOOL"`, `details: { tool: string; content: unknown[] }`, message = joined text content or `"tool <name> reported an error"`.
  - `call(name, args)` returns the SDK `CallToolResult` unchanged on success.
  - Error mapping (applies to all client methods): HTTP 401 (after renewal) and 403 → `AuthError` with message `"MCP endpoint <url> rejected the credentials (HTTP <status>): the account needs the 'access mcp server' permission, and bearer tokens need the mcp_server_oauth module on the site"`; 404 → `HttpError(404, "no MCP endpoint at <url> (is mcp_server enabled?)")`; JSON-RPC error → `HttpError(0, <server message>)`.

- [ ] **Step 1: Write failing tests** (`client-call.test.ts`)
  - tool `echo` with `inputSchema { type: "object", properties: { n: { type: "integer" } }, required: ["n"] }`: `call("echo", { n: "x" })` rejects with `ValidationError` whose `details.errors[0].instancePath === "/n"`, and `server.calls.length === 0` (AC-2).
  - `call("echo", { n: 2 })` returns a result whose `structuredContent` equals the server's; `server.calls` is `[{ name: "echo", args: { n: 2 } }]`.
  - tool `fail` returning `isError: true` with text `"ticket already claimed"` → rejects `ToolCallError`, message `"ticket already claimed"` (AC-3).
  - unknown tool → `ValidationError` (message contains `"unknown tool"`), no `tools/call` sent.
  - server answering 403 → `AuthError` whose message contains `access mcp server` and `mcp_server_oauth` (Review Focus 4); 404 → `HttpError` status 404 containing `is mcp_server enabled?`.
  - tool `noargs` with `inputSchema { type: "object" }`: `call("noargs", {})` succeeds and the server saw `{}` (Review Focus 5).
  - server that returns 502 once for `tools/call`: `call` rejects and the server saw exactly one `tools/call` (no retry).
- [ ] **Step 2: Run** `cd plugins/tool && pnpm vitest run client-call` — Expected: FAIL.
- [ ] **Step 3: Implement** `call`: `get(name)` → unknown → `ValidationError`; `validatePayload(tool.inputSchema, args, \`tool ${name}\`)`; `client.callTool({ name, arguments: args })`; `isError` → `ToolCallError`. One private `mapError(err, url)` used by every method for the HTTP/JSON-RPC mapping.
- [ ] **Step 4: Run** plugin tests, then root `pnpm run lint && pnpm run typecheck && pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(tool): validate arguments and map tool errors`

### Task 3: `dropsh tool` CLI and plugin wiring

**Files:**
- Create: `plugins/tool/src/{args.ts,command.ts}`, `plugins/tool/tests/unit/{args,command,index}.test.ts`, `plugins/tool/README.md`
- Modify: `plugins/tool/src/index.ts`, `src/plugin-api.ts` (add `exitCodeFor` to the existing `./errors.js` export line)

**Interfaces:**
- Consumes: Task 1/2 `createToolClient`, `ToolCallError`; `PluginCommandServices.getContext()` → `CommandContext { auth, baseUrl }`; `readDataArg` behaviour (`--data` accepts JSON or `@file`) — reimplement the ~15 lines locally since `readDataArg` is not exported, or add it to `plugin-api.ts` alongside `exitCodeFor` (additive; builder's choice).
- Produces:
  - `buildArguments(schema: Record<string, unknown>, data: unknown, params: string[]): Record<string, unknown>` — `data` must be a JSON object (else `ValidationError`); each `k=v` (split on the first `=`, missing `=` → `ValidationError`) overrides; coercion by `schema.properties[k].type`: `integer`/`number` → `Number(v)` (NaN keeps the string so validation reports it), `boolean` → `"true"`/`"false"`, `object`/`array` → `JSON.parse(v)` (parse error → `ValidationError`), else string.
  - `toolPlugin(raw?: unknown): DropSHPlugin` with `id: "tool"`, `registerCommands` adding:
    - `dropsh tool [name]` with options `--schema`, `--param <k=v...>` (repeatable), `--data <json|@file>`.
    - no `name` → stdout `JSON.stringify(list.map(({name,title,description}) => …), null, 2)`.
    - `name --schema` → stdout `{ name, inputSchema, outputSchema? }`.
    - `name` → `call` → stdout `structuredContent ?? content`, exit 0.
    - any error → stderr `{ "error": { code, message, details } }` (same shape as core `output.fail`), `process.exitCode = exitCodeFor(err)`; `ToolCallError` → exit 1. Always `close()` the client in `finally`.

- [ ] **Step 1: Write failing tests**
  - `args.test.ts`: integer/number/boolean/object coercion; `--param` overrides `--data`; `"a"` without `=` throws; `--data "[1]"` throws; `--param extra=1` with no `extra` in schema stays `"1"` (Review Focus 2).
  - `command.test.ts` (commander program + `services` stub whose `getContext` returns the test server's `baseUrl` and a bearer `auth`): list prints all tool names; `--schema` prints the input schema; call prints `structuredContent`; invalid param → exit 4 and stderr `error.code === "E_VALIDATION"` with no `tools/call` on the server; `isError` → exit 1, stderr message is the tool text; `dropsh tool nope` → exit 4 with message listing close names such as `echo` (Review Focus 1).
  - `index.test.ts` (AC-4): `buildProgram({ plugins: [] })` has no `tool` command; `buildProgram({ plugins: [toolPlugin()] })` has it; the root `package.json` has no `@modelcontextprotocol/sdk` in `dependencies` (the SDK stays plugin-only).
- [ ] **Step 2: Run** `cd plugins/tool && pnpm vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** `args.ts`, `command.ts`, wire `registerCommands` in `index.ts` (`toolPlugin(raw)` calls `parseToolOptions(raw)`), add the export to `src/plugin-api.ts`. Closest names: rank by shared prefix length then Levenshtein, top 5.
- [ ] **Step 4: Write `plugins/tool/README.md`** — install (`pnpm add dropsh @dropsh/plugin-tool`), config snippet `{ plugin: "@dropsh/plugin-tool", export: "toolPlugin", with: { endpoint: "/mcp" } }`, server requirements (`tool`, `mcp_server`, `mcp_server_tool_bridge`, `mcp_server_oauth`, permission `access mcp server`, OAuth scopes), CLI examples, library example from the spec, "no retries" note.
- [ ] **Step 5: Run** root `pnpm run lint && pnpm run typecheck && pnpm test` — PASS (existing suites unchanged = AC-4).
- [ ] **Step 6: Commit** `feat(tool): dropsh tool command`

### Task 4: Integration fixture and end-to-end tests

**Files:**
- Modify: `tests/integrations/drupal/composer.json` (+ `composer.lock` via `ddev composer require`): `drupal/tool:^1.0@beta`, `drupal/tool_belt`, `drupal/mcp_server:^2.0@beta`, `drupal/mcp_server_tool_bridge:1.x-dev`, `drupal/mcp_server_oauth:1.x-dev` (use the newest tagged release where one exists).
- Create: `tests/integrations/bin/init-tools.sh` (pattern: `init-jsonapi-schema.sh`; URI `tools.<project>.ddev.site`, DB `dropsh_tools`), `tests/integrations/drupal/fixtures/setup-tools.php`, `tests/integrations/tool.test.ts`
- Modify: `sites-templates/sites.php` (add `'tools'`), `bin/drupal-up.sh` (call `init-tools.sh`, list URL), `bin/drupal-down.sh` (remove `web/sites/tools`), `helpers/config.ts` (`SiteName` + `"tools"`, `defaultAuth: "oauth2_password"`), `helpers/run.ts` (`pluginImport("tool")` → `toolPlugin()`).

**Interfaces:**
- Consumes: Task 3 `toolPlugin`; existing `runCli({ site, args })`, `parseJson`, `parseError`, `setup-users.php`, `setup-oauth.php`.
- Produces: site `tools` where the `integration:content` OAuth scope's role has `access mcp server`, and one `McpToolConfig` exposing Tool Belt's `tool_belt:entity_create` under MCP name `entity_create` (any Tool Belt tool with a required input works; record the chosen name as `TOOLS_FIXTURE_TOOL` in `helpers/config.ts`).

- [ ] **Step 1: Provision** — enable `basic_auth jsonapi tool tool_belt tool_belt_content mcp_server mcp_server_tool_bridge mcp_server_oauth simple_oauth simple_oauth_password_grant simple_oauth_21 consumers`; run `setup-content-type.php`, `setup-users.php`, `setup-oauth.php`, `setup-tools.php` (grants the permission, creates the `McpToolConfig`). Run `pnpm run drupal:up`; Expected: `init-tools done at https://tools.…`.
- [ ] **Step 2: Write `tool.test.ts`**
  - AC-1: `dropsh tool` exit 0, parsed array contains `TOOLS_FIXTURE_TOOL`.
  - `--schema` exit 0, `inputSchema.type === "object"`.
  - AC-2: call with a valid `--data` creating an `article_test` node returns exit 0, and `dropsh read node/article_test/<uuid>` finds it; call missing a required input → exit 4, `error.code === "E_VALIDATION"`, and no node was created.
  - AC-3: call with schema-valid but server-rejected input (e.g. non-existent bundle) → exit 1 with the tool's message.
  - AC-4: basic-auth run of `dropsh tool` against the `tools` site → exit 3 naming `mcp_server_oauth`; `dropsh tool` against the `plain` site (no `mcp_server`) → exit 5 naming `is mcp_server enabled?`.
- [ ] **Step 3: Run** `pnpm run test:integration` — Expected: the new file passes and every existing integration file still passes.
- [ ] **Step 4: Commit** `test(tool): integration site and end-to-end tool tests`

## Spec coverage check

| Spec item | Task |
|---|---|
| Goals 1, 3, 5 (plugin, library, credentials) | 1 |
| Goal 4, AC-2, AC-3, AC-5 | 2 (library), 3 (CLI), 4 (e2e) |
| Goal 2, AC-1 | 1 (pagination), 3 (CLI), 4 (e2e) |
| AC-4, Goal 6 (no breaking change) | 3 (`index.test.ts`, existing suites), 4 |
| No retries | 1, 2 |
| Error messages for 401/403/404 | 2, 4 |
| Docs | 3 (README) |
