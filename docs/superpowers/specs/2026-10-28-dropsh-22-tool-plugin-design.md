# DROPSH-22 — `dropsh tool`: call Drupal Tool API tools from the CLI and as a library

Status: design, awaiting approval. Supersedes the "action catalog" scope in the
DROPSH-22 ticket description.

## Intent

dropsh reaches only entity bundles over JSON:API. Business operations on a
Drupal site — claim a ticket, instantiate a template, send an inbox message,
propose a time submission — have no bundle. Today they are custom
`jsonapi_resources` routes. Clients either hard-code them (the bakers.build
conductor calls `api.post('bakers/claim-next', …)`) or hand-write one CLI
subcommand per operation (`bakers dropsh template run …`). There is no
discovery, no schema and no validation, and every change on the server has to
be mirrored by hand on the client.

The operator decided (conversation of 2026-10-28):

- **Reading and querying stays JSON:API.** Lists, filters, paging, includes and
  HTTP caching are what JSON:API is for (TUI, `read`, `search`, conductor
  polling). JSON:API is not switched off and dropsh's JSON:API behaviour is not
  restructured.
- **Business operations become Drupal Tool API tools** (`drupal/tool`). The
  tool definition in Drupal is the single source of truth: typed inputs
  advertised as JSON Schema, validation and access control are part of the
  tool contract, so the API stays consistent with the code that runs it.
- **Tools reach clients over Drupal's own MCP endpoint** (`drupal/mcp_server`,
  `/mcp`). Claude uses that endpoint directly as an MCP connector. dropsh is no
  longer needed as an MCP server for this.
- **dropsh gets a `tool` add-on** so a human in the terminal — and programs such
  as the conductor — can list and call the same tools: generic, discovered from
  the server, no hand-written command per operation.

Skills therefore talk to operations either through `dropsh tool` or through
the Drupal MCP connector; both see the same tool definitions.

## Goals

1. A new plugin package `@dropsh/plugin-tool` (`plugins/tool`) that acts as an
   **MCP client** of a Drupal site's `mcp_server` endpoint.
2. CLI, registered by the plugin through `registerCommands`:
   - `dropsh tool` — list every tool the current credentials can see
     (name, title/description).
   - `dropsh tool <name> --schema` — print the tool's input schema (and output
     schema when the server advertises one).
   - `dropsh tool <name> [--param k=v …] [--data <json|@file>]` — call the tool
     and print its result.
3. A **library API** exported from the package, so TypeScript callers (the
   bakers.build conductor) call tools without the CLI:
   `createToolClient({ auth, baseUrl, endpoint?, fetch? })` returning an
   object with `list()`, `get(name)`, `call(name, args)` and `close()`.
4. **Client-side validation before sending:** arguments are validated against
   the tool's `inputSchema` from `tools/list` with dropsh's existing
   `validatePayload`; a violation is rejected before any `tools/call`, and the
   error names the failing schema path.
5. **Same credentials as JSON:API:** every request is authorised through the
   connection's `AuthAdapter` (`auth.apply`, and `auth.renew` once after a
   401), so the existing OAuth2 profiles and token renewal apply unchanged.
   The MCP SDK transport receives a `fetch` wrapper that does this; dropsh's
   retrying `HttpClient` is not used (see "No automatic retries").
6. **No breaking change.** Everything outside the new package is additive:
   existing commands, configuration, plugins (including `plugins/mcp`) and
   public exports behave exactly as before.

## Acceptance criteria (replace the ticket's original four)

- **AC-1** Against a site with `mcp_server` exposing tools, `dropsh tool` lists
  every tool that `tools/list` returns for the current credentials, following
  pagination cursors to the end.
- **AC-2** `dropsh tool <name>` sends `tools/call` with the given arguments; an
  argument set that violates the tool's input schema is rejected before
  sending, and the error names the schema violation.
- **AC-3** A tool that reports failure (`isError: true`) or a protocol error
  surfaces the server's message on stderr and exits non-zero; a successful
  call prints the result and exits zero.
- **AC-4** Without the plugin configured, or against a site without
  `mcp_server`, every existing command (entity CRUD, schema, auth, TUI, the
  existing MCP plugin) behaves unchanged; `dropsh tool` against such a site
  fails with a clear message naming the endpoint and the likely cause.
- **AC-5** The library API performs the same list/validate/call behaviour as
  the CLI without going through commander.

## Non-goals

- No change to JSON:API commands, schema plugins or the dropsh core command set.
- No action catalog format, no OpenAPI, no fixed catalog path — all dropped in
  favour of Tool API + MCP.
- No `list_actions` / `call_action` in `plugins/mcp`; Claude uses Drupal's MCP
  endpoint directly.
- Removing `plugins/mcp` (dropsh as MCP server). The operator no longer needs
  it, but removal is a breaking change for existing users and is a separate
  ticket.
- Server-side work in bakers.build (installing `tool` / `mcp_server`,
  converting the 13 `jsonapi_resources` operations to tools, moving the
  conductor's operation calls to the tool client) — a bakers.build ticket.
- MCP resources, prompts, sampling or streaming notifications. Only
  `initialize`, `tools/list` and `tools/call`.
- STDIO transport to `drush mcp:server`. HTTP only.

## Anti-goals

- dropsh must not grow a second, dropsh-specific description of operations.
  If a tool changes in Drupal, `dropsh tool` reflects it on the next call with
  no dropsh release.
- The MCP SDK must not become a dependency of the dropsh core package; it stays
  inside `plugins/tool`.
- `dropsh tool` must not weaken validation: no silent pass-through of
  arguments when a schema is present.

## Constraints and facts (verified 2026-10-28)

- `drupal/tool` 1.0.0-beta12, `drupal/mcp_server` 2.0.0-beta6 (Drupal ^10.5 ||
  ^11, PHP ^8.3), `drupal/mcp_server_tool_bridge` (unreleased; one
  `McpToolConfig` config entity per exposed Tool API tool),
  `drupal/mcp_server_oauth` (depends on `simple_oauth` and `simple_oauth_21`).
  All pre-1.0/beta.
- `mcp_server` serves Streamable HTTP at `POST /mcp` (base path is a container
  parameter). The route requires the permission `access mcp server` and, out
  of the box, accepts **cookie auth only**. `mcp_server_oauth` adds `oauth2`
  bearer auth to the route. Consequence: `dropsh tool` works with dropsh's
  OAuth2 profiles once the site has `mcp_server_oauth`; dropsh's basic-auth
  profile is not accepted by a stock `mcp_server` and the error message must
  say so.
- dropsh already ships `@modelcontextprotocol/sdk` 1.32.1 (in `plugins/mcp`);
  `plugins/tool` pins the same version.
- dropsh's integration Drupal (`tests/integrations/drupal`) runs PHP 8.3 and
  already includes `simple_oauth` and `simple_oauth_21`.
- `validatePayload`, `ValidationError`, `HttpError` and `createHttpClient` are
  exported from `dropsh/plugin`; `resolveAuth` from the main `dropsh` entry.
- Token: `mcp_server_oauth` validates the bearer token through Simple OAuth's
  resource server (the same validation JSON:API uses); no audience/resource
  indicator check. A tool may declare required OAuth scopes; a token missing
  them is rejected. dropsh's OAuth2 profiles already carry a `scope` setting,
  so this is configuration, not code.
- Schema dialect: Tool API emits plain JSON Schema without `$schema`, using
  only keywords that draft-07 Ajv understands (`type`, `properties`,
  `required`, `items`, `enum`, `const`, `oneOf`, `anyOf`, `format`, `pattern`,
  min/max…). The existing `validatePayload` is sufficient; no 2020-12 support
  is needed in this ticket.

## Behaviour

### Endpoint and session

- Endpoint URL: `{baseUrl}{endpoint}` with plugin option `endpoint`, default
  `/mcp`. Not under `jsonapi_prefix`.
- One MCP session per CLI invocation / per `createToolClient` instance:
  `initialize` lazily on first use; terminate the session on CLI exit (library:
  a `close()` method).
- Every HTTP request is built by applying the connection's `AuthAdapter`, so a
  renewed token is used transparently.
- **No automatic retries** (decision: designer's call). The tools this exists
  for are non-idempotent (claim, instantiate, send); a retry after a gateway
  502 or timeout could run the operation twice. The transport sends each
  request once; the only repeat is the single re-send after a successful
  `auth.renew()` following a 401, which the server rejected before running
  anything.

### Listing

- `tools/list` with cursor pagination until `nextCursor` is absent. The result
  is cached for the lifetime of the client (one invocation), not on disk.
- CLI output is JSON on stdout (plugin commands receive no renderer
  service), an array with one object per tool: `name`, `title` (or
  `annotations.title`), `description`. Errors are printed in dropsh's existing
  error shape `{ "error": { code, message, details } }` on stderr with the
  existing exit codes (`exitCodeFor`, newly exported from `dropsh/plugin`).

### Schema

- `--schema` prints `{ name, inputSchema, outputSchema? }` for the tool.
- Unknown tool name → `ValidationError` listing the closest names.

### Calling

- Arguments are built from `--data` (JSON object, or `@file`) and then
  `--param k=v` pairs, which override keys from `--data`. A `--param` value is
  coerced by the input schema's declared type for that top-level property
  (`integer`/`number` → number, `boolean` → `true`/`false`,
  `object`/`array` → parsed JSON); otherwise it stays a string. Dotted keys are
  not supported in this ticket.
- Validation: `validatePayload(inputSchema, args, "tool <name>")` before
  sending. No opt-out flag.
- Result: if the result has `structuredContent`, print it; otherwise print the
  `content` array (text items as their text). `isError: true` → print the text
  content to stderr, exit code 1.
- JSON-RPC / HTTP errors map to dropsh errors: 401/403 → `AuthError` naming the
  `access mcp server` permission and, for basic auth, the missing
  `mcp_server_oauth`; 404 → `HttpError` "no MCP endpoint at <url>
  (is mcp_server enabled?)"; JSON-RPC error → `HttpError` with the server's
  message.

### Library API (sketch, final names left to the plan)

```ts
const tools = createToolClient({ http, auth, baseUrl, endpoint: "/mcp" });
const list = await tools.list();                 // ToolInfo[]
const def = await tools.get("bb_ticket_claim");  // ToolInfo | undefined
const result = await tools.call("bb_ticket_claim", { ticket: uuid }); // validates first
await tools.close();
```

`call` throws `ValidationError` on schema violation and a typed error
(`ToolCallError`, carrying the text content) for `isError` results. Otherwise
it returns the SDK's `CallToolResult` unchanged (decision: designer's call) —
the standard MCP type, so callers read `structuredContent` when the tool
provides it and `content` otherwise, and the library never guesses a lossy
conversion.

## Testing

- **Unit (vitest, `plugins/tool/tests/unit`)** against an in-process MCP
  server built with the SDK's `McpServer` + `StreamableHTTPServerTransport` on
  loopback (same approach as `plugins/mcp` tests): listing with pagination,
  `--schema`, argument building/coercion, validation rejects before any
  `tools/call` reaches the server, `isError` → exit 1, 401/403/404 mapping,
  auth header applied on every request.
- **Integration (`tests/integrations/tool.test.ts`)** against a new DDEV
  subsite `tools` provisioned by `tests/integrations/bin/init-tools.sh`:
  `tool`, `tool_belt` (provides ready-made tools, so no fixture PHP), 
  `mcp_server`, `mcp_server_tool_bridge`, `mcp_server_oauth`, OAuth client and
  a role with `access mcp server`; one `McpToolConfig` exposing a Tool Belt
  tool. Covers AC-1…AC-3 end to end with an OAuth2 profile.
- **Regression (AC-4):** the existing unit and integration suites pass
  unchanged; a unit test asserts that a config without the tool plugin
  registers no `tool` command and loads no MCP SDK.

## Left to the builder

- Internal module layout of `plugins/tool/src`, exact type names, and how the
  SDK client transport receives authenticated requests (custom `fetch` that
  routes through `auth.apply` is the expected shape).
- Table/markdown rendering details for the list output.
- Which Tool Belt tool the integration fixture exposes, as long as it is
  callable with valid input and rejects invalid input by schema.

## Follow-up tickets (not part of DROPSH-22)

1. bakers.build: install `tool`, `mcp_server`, `mcp_server_tool_bridge`,
   `mcp_server_oauth`; turn the business operations (claim-next, ticket claim,
   heartbeat, offline, template instantiate, inbox send/result, addons
   register, time submission propose) into Tool API tools sharing one service
   with any route that stays; skills use `dropsh tool` or the Drupal MCP
   connector; the conductor calls operations through `createToolClient`.
   Skills also run in Claude environments without a shell (connectors only),
   where the Drupal MCP connector is the only channel, so bakers.build must
   also expose the reads and creates those skills need (e.g. create, read and
   search tickets) as domain tools, not only the operations.
2. dropsh: remove `plugins/mcp` (dropsh as MCP server), with a deprecation note
   and major-version release. Rationale: it runs only locally (stdio or
   loopback HTTP), so shell-less Claude environments cannot reach it anyway;
   environments with a shell use the dropsh CLI directly.
