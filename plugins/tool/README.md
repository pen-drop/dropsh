# @dropsh/plugin-tool

Optional plugin for [dropsh](https://github.com/pen-drop/dropsh) that lists,
describes and calls a Drupal site's [Tool API](https://www.drupal.org/project/tool)
tools over the site's own MCP endpoint
([`mcp_server`](https://www.drupal.org/project/mcp_server)). It is an MCP
*client*: the tool definitions in Drupal are the single source of truth, so a
changed tool is picked up on the next call without a dropsh release.

JSON:API stays the path for reading and querying entities; this plugin is for
business operations that have no bundle (claim, instantiate, send, …).

The package is not bundled in the `dropsh` tarball. Install it next to dropsh:

```bash
pnpm add dropsh @dropsh/plugin-tool
```

## Configuration

```js
{
  plugin: "@dropsh/plugin-tool",
  export: "toolPlugin",
  with: { endpoint: "/mcp" },
}
```

`endpoint` is optional (default `/mcp`) and is appended to the connection's
`base_url`, not to the JSON:API prefix.

## Server requirements

- `tool` and the modules providing your tools (e.g. `tool_belt`).
- `mcp_server` and `mcp_server_tool_bridge`, with one MCP tool config per
  exposed tool.
- `mcp_server_oauth` (with `simple_oauth` and `simple_oauth_21`). A stock
  `mcp_server` accepts cookie auth only, so dropsh's bearer tokens — and its
  basic-auth profile — are rejected without it.
- The account needs the `access mcp server` permission; a tool may also require
  OAuth scopes, which you set in the dropsh OAuth2 profile's `scope`.

Requests use the connection's auth profile exactly like JSON:API requests,
including one token renewal after a 401.

## CLI

```bash
dropsh tool                                   # list tools: name, title, description
dropsh tool bb_ticket_claim --schema          # input (and output) schema
dropsh tool bb_ticket_claim --param ticket=<uuid>
dropsh tool time_propose --data @entries.json --param dry_run=true
```

`--data` takes a JSON object or `@file`; `--param key=value` (repeatable)
overrides its keys. A `--param` value is coerced by the schema's type for that
top-level property (`integer`/`number`, `boolean`, `object`/`array` as JSON);
otherwise it stays a string.

Arguments are validated against the tool's input schema before anything is
sent. The result is printed as JSON on stdout: `structuredContent` when the tool
returns it, otherwise the `content` array (text items as their text).

Errors use dropsh's error shape on stderr. Exit codes: `1` the tool reported an
error (`E_TOOL`), `3` credentials rejected, `4` invalid arguments or unknown
tool, `5` HTTP or protocol error (e.g. no MCP endpoint).

## Library

```ts
import { createToolClient } from "@dropsh/plugin-tool";

const tools = createToolClient({ auth, baseUrl, endpoint: "/mcp" });
const list = await tools.list();                 // ToolInfo[]
const def = await tools.get("bb_ticket_claim");  // ToolInfo | undefined
const result = await tools.call("bb_ticket_claim", { ticket: uuid }); // validates first
await tools.close();
```

`call` throws `ValidationError` on a schema violation and `ToolCallError` for an
`isError` result; otherwise it returns the MCP `CallToolResult` unchanged.

## No retries

Tools are often not idempotent, so a request is sent once. The only re-send is
after a 401 when the auth profile renewed its token, which the server rejected
before running anything.
