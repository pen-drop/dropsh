# @dropsh/plugin-jsonapi-schema

Authoritative JSON:API write-schema source for [dropsh](https://github.com/pen-drop/dropsh),
the entity-agnostic CLI for Drupal 11 JSON:API.

dropsh works without this plugin. By default it derives a shallow schema from
JSON:API sample records, which is enough to discover field names but does not
know Drupal's required fields, formats, or constraints.

With this plugin installed, `dropsh schema` reads the **authoritative** schema
from Drupal's [`jsonapi_schema`](https://www.drupal.org/project/jsonapi_schema)
module. The generated schema carries `required` fields, `maxLength`, and
`format` constraints, so client-side validation in `create` / `update` catches
invalid payloads before they are sent to Drupal.

## Why not `schemata`?

The older `@dropsh/plugin-schemata` targets the `schemata_json_schema` module,
whose `/schemata/{entity}/{bundle}` endpoint returns **HTTP 500 on Drupal 11 /
PHP 8.4**. `jsonapi_schema` is actively maintained, supports Drupal 10.1+/11,
and serves its schema routes under the JSON:API prefix (`/jsonapi/*`), so it
authenticates with the same credentials as every other dropsh request.

Unlike `schemata`, this plugin never swallows a broken endpoint silently: a
missing module (404) or a broken endpoint (5xx / unparseable body) both fall
back to the heuristic schema **with a visible warning** explaining why.

## Install

```bash
pnpm add @dropsh/plugin-jsonapi-schema
```

`dropsh` is a peer dependency.

## Usage

```js
import { jsonapiSchemaPlugin } from "@dropsh/plugin-jsonapi-schema";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [jsonapiSchemaPlugin()],
};
```

```bash
dropsh schema node/article --for=create
```

The output carries `x-dropsh-source: "jsonapi-schema"` when the authoritative
schema was used (vs `"heuristic"` / `"heuristic-empty"` for the sample-derived
fallback).

## Required Drupal module

- [`jsonapi_schema`](https://www.drupal.org/project/jsonapi_schema) (`^1.0`)

Install and enable it on the Drupal site:

```bash
composer require drupal/jsonapi_schema
drush en jsonapi_schema
```

**Authentication note:** the schema routes (`…/resource/schema`) do not declare
`_auth`, so Drupal core `basic_auth` (which is `global: false`) cannot
authenticate them — an authenticated basic request is rejected with 403 (the
same limitation the `schemata` module has). Use an auth provider that is
registered globally, such as OAuth2 Bearer via `simple_oauth` (see
`@dropsh/plugin-oauth2`), or grant the anonymous role access to the routes if
your schemas are non-sensitive.

## How it works

The plugin fetches the **resource-object** schema at
`{jsonapi_prefix}/{entity}/{bundle}/resource/schema`, inlines its local
`#/definitions` graph, drops the external `https://jsonapi.org/schema#` `$ref`
(which Ajv cannot fetch), and wraps the resource object as the `data` member of
a JSON:API document envelope — the exact shape a create/update payload must
satisfy. dropsh's operation transform then tailors `required` per operation
(`id` is stripped for create; `type`/`id` are required for update).

## License

MIT OR GPL-2.0-or-later
