# @dropsh/plugin-canvas

Canvas component schemas for [dropsh](https://github.com/pen-drop/dropsh), the
entity-agnostic CLI for Drupal 11 JSON:API.

Extends the `dropsh schema` output for Canvas pages with a typed
`attributes.components` array built from the site's Single Directory Components
(SDC), so `create` / `update` payloads for `canvas_page` can be validated against
the real component set.

## Install

```bash
pnpm add @dropsh/plugin-canvas
```

`dropsh` is a peer dependency. The plugin depends on `@dropsh/sdc-client`
(installed automatically).

## Usage

```js
import { canvasPlugin } from "@dropsh/plugin-canvas";

export default {
  site: { base_url: "https://my-drupal.example.com", jsonapi_prefix: "/jsonapi" },
  plugins: [canvasPlugin()],
};
```

```bash
dropsh schema canvas_page/canvas_page --for=create
```

The returned JSON Schema includes `x-dropsh-builder: "canvas"`,
`x-dropsh-components`, and a typed `attributes.components` array. If `jsonapi_sdc`
is missing or inaccessible, the Canvas schema **fails** (rather than returning
incomplete component information) so you never validate against a partial set.

## Required Drupal modules

- `canvas`
- `jsonapi_sdc`

## License

MIT OR GPL-2.0-or-later
