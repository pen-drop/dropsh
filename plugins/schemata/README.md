# @dropsh/plugin-schemata

Authoritative JSON Schema source for [dropsh](https://github.com/pen-drop/dropsh),
the entity-agnostic CLI for Drupal 11 JSON:API.

By default dropsh derives a shallow schema from sample records (field names only,
no required fields or constraints). With this plugin installed, `dropsh schema`
instead returns the **authoritative** schema from Drupal's `schemata` module —
with required fields and constraints — so client-side validation in `create` /
`update` is meaningful.

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
- `jsonapi_schema` (provided by the schemata project)

## License

MIT OR GPL-2.0-or-later
