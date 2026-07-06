# @dropsh/sdc-client

Single Directory Components (SDC) client for [dropsh](https://github.com/pen-drop/dropsh),
the entity-agnostic CLI for Drupal 11 JSON:API.

A small library that fetches and types a Drupal site's SDC component definitions
via the `jsonapi_sdc` module. It is the building block used by
[`@dropsh/plugin-canvas`](https://www.npmjs.com/package/@dropsh/plugin-canvas) to
build Canvas component schemas; you normally depend on it transitively rather than
directly.

## Install

```bash
pnpm add @dropsh/sdc-client
```

`dropsh` is a peer dependency.

## Usage

```ts
import { fetchSdcComponents, type SdcComponent } from "@dropsh/sdc-client";
import type { PluginContext } from "dropsh/plugin";

async function listComponents(ctx: PluginContext): Promise<SdcComponent[]> {
  return fetchSdcComponents(ctx); // uses ctx.http / ctx.auth / ctx.baseUrl
}
```

`fetchSdcComponents` throws an `HttpError` (status 404) when `jsonapi_sdc` is not
installed or reachable.

## Required Drupal module

- `jsonapi_sdc`

## License

MIT OR GPL-2.0-or-later
