# @dropsh/plugin-mcp

Optional [Model Context Protocol](https://modelcontextprotocol.io) server for
[dropsh](https://github.com/pen-drop/dropsh). It exposes six allowlisted JSON:API
operations and a startup snapshot of Markdown files over stdio or loopback HTTP.

The package is not bundled in the `dropsh` tarball. Install it next to dropsh:

```bash
pnpm add dropsh @dropsh/plugin-mcp
```

Create and update require an authoritative schema plugin such as
`@dropsh/plugin-jsonapi-schema`. Heuristic-only schemas are rejected for writes.

## Configuration

```js
{
  plugin: "@dropsh/plugin-mcp",
  export: "mcpPlugin",
  with: {
    bundles: ["gaia_ticket/gaia_ticket", "node/article"],
    operations: ["list_entities", "search", "read", "create", "update", "describe"],
    markdownDir: "./mcp-skills"
  }
}
```

`bundles` and `operations` are required arrays. Empty arrays expose no entity
tools. There is no wildcard. `markdownDir` is optional and resolved against the
process working directory.

## Transports

Exactly one transport flag is required:

```bash
dropsh --config ./dropsh.config.js mcp serve --stdio
dropsh --config ./dropsh.config.js mcp serve --http 8787
```

HTTP listens on `127.0.0.1` and accepts `POST /mcp` only. `GET` and `DELETE`
return 405. Host and Origin must match the local listener. Put a reverse proxy
in front for remote access; this plugin does not provision TLS, CORS, or an
OAuth discovery server. A proxy must present the permitted upstream Host/Origin.

Stdio uses the selected dropsh profile, including token renewal. HTTP does not
fall back to that profile: a `Authorization: Bearer …` header is passed through
unchanged, and a missing header is anonymous. Malformed or non-Bearer
authorization is rejected at the HTTP boundary. A backend 401 or 403 is
preserved in the MCP error (`backendStatus`); initialize itself does not call
Drupal and cannot invent a 401.

Request bodies are limited to 1 MiB. Diagnostics go to stderr. Stdout carries
only MCP protocol frames.

## Tools

Tool names stay fixed. Selectors come from the allowlist. Direct calls to a
disallowed bundle or unadvertised operation fail without backend I/O.

Create example:

```json
{
  "entityType": "node",
  "bundle": "article",
  "payload": {
    "data": {
      "type": "node--article",
      "attributes": {
        "title": "Hello",
        "body": { "value": "# Markdown", "format": "basic_html" }
      }
    }
  }
}
```

`payload` is a JSON:API document. `data.type` must match `entityType--bundle`.
Update also requires `payload.data.id` to match `id`. Successful results return
the unabridged JSON:API document, including backend identifiers.

## Markdown prompts and resources

When `markdownDir` is set, dropsh reads only direct, regular, non-symlink `.md`
files at startup. `create-ticket.md` becomes prompt `create-ticket` and resource
`dropsh://prompts/create-ticket`. Client strings are never used as filesystem
paths. A missing or unreadable directory fails startup; omitting `markdownDir`
yields empty lists.

Files in that directory are published MCP content, not a private per-user
filesystem. Connector UIs that display prompts or resources are client-dependent:
protocol exposure does not prove claude.ai (or any other host) will show them.
