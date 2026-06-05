# @dropsh/plugin-schemata

Authoritative JSON Schema source for [dropsh](https://github.com/pen-drop/dropsh),
the entity-agnostic CLI for Drupal 11 JSON:API.

dropsh works without this plugin. By default it derives a shallow schema from
JSON:API sample records, which is enough to discover field names but does not
know Drupal's required fields or constraints.

With this plugin installed, `dropsh schema` reads the **authoritative** schema
from Drupal's `schemata` module. The generated schema is more precise, so
client-side validation in `create` / `update` can catch invalid payloads before
they are sent to Drupal.

## Install

```bash
pnpm add @dropsh/plugin-schemata
```

`dropsh` is a peer dependency.

## Usage

```js
import { schemataPlugin } from "@dropsh/plugin-schemata";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [schemataPlugin()],
};
```

```bash
dropsh schema node/article --for=create
```

The output carries `x-dropsh-source: "schemata"` when the authoritative schema was
used (vs `"heuristic"` / `"heuristic-empty"` for the sample-derived fallback). If
the modules are missing or the endpoint is unreachable, the plugin transparently
falls back to the base schema.

## Required Drupal modules

- [`schemata`](https://www.drupal.org/project/schemata)
- `schemata_json_schema` (submodule of the schemata project)

Install and enable both on the Drupal site:

```bash
composer require drupal/schemata
drush en schemata schemata_json_schema
```

Grant the role used by dropsh access to the Schemata data model endpoint:

```bash
drush role:perm:add "content_editor" "access schemata data models"
```

For OAuth2, grant the permission to the user role or client credential access
context used by the configured auth provider.

## License

MIT OR GPL-2.0-or-later
