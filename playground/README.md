# Playground

Vier Unterordner, vier Drupal-Sites, ein DDEV. Jeder Ordner hat seine
eigene `dropsh.config.js` für ein konkretes Integrations-Szenario.

| Ordner      | DDEV-URL                                    | Plugin-Stack                              |
|-------------|---------------------------------------------|-------------------------------------------|
| `plain/`    | `http://dropsh-test.ddev.site`              | `oauth2Plugin` (OAuth 2.0 Authcode + PKCE)|
| `schemata/` | `http://schemata.dropsh-test.ddev.site`     | `basicAuthPlugin` + `schemataPlugin`      |
| `canvas/`   | `http://canvas.dropsh-test.ddev.site`       | `oauth2Plugin` + `canvasPlugin`           |
| `db/`       | `http://db.dropsh-test.ddev.site`           | `oauth2Plugin` + `displayBuilderPlugin`   |

## Setup

```bash
pnpm run drupal:up         # provisioniert alle 4 Sites
pnpm run build             # Haupt-Package
pnpm run build:plugins     # Plugins
cd playground
pnpm install
```

Zugangsdaten (alle vier Sites teilen dieselben Werte aus der Fixture):

- Admin: `admin / admin`
- Tester: `tester / tester-pw`
- OAuth Consumer (plain, canvas, db): `tests-authcode`

## plain/ — Basic CRUD + OAuth

OAuth-Login (interaktiv, öffnet Browser):

```bash
cd plain
npx dropsh --config dropsh.config.js login
```

Danach beliebige Operationen mit demselben Token:

```bash
npx dropsh --config dropsh.config.js search node --bundle=article_test --limit=3
npx dropsh --config dropsh.config.js create node --bundle=article_test --data=@create-article.json
```

## schemata/ — Schema-Discovery + Client-Validierung

```bash
cd schemata
# Catalog
npx dropsh --config dropsh.config.js schema
# Schema für ein Bundle (cached in .dropsh/cache/schema/)
npx dropsh --config dropsh.config.js schema node/article_test
npx dropsh --config dropsh.config.js schema node/article_test --for=create
npx dropsh --config dropsh.config.js schema node/article_test --for=update
```

Das Feld `x-dropsh-source` im Output zeigt die Schema-Quelle (`schemata`
für echtes JSON-Schema aus dem Drupal-Modul).

## canvas/ — Canvas Components

```bash
cd canvas
# Schema mit Canvas-Component-Metadaten
npx dropsh --config dropsh.config.js schema canvas_page/canvas_page --for=create
```

## db/ — Display Builder

Display-Builder-Schema mit Metadaten aus der Drupal Entity-View-Display-
Konfiguration:

```bash
cd db
# einmalig: OAuth-Login (öffnet Browser)
npx dropsh --config dropsh.config.js login
npx dropsh --config dropsh.config.js schema node/article --for=create
```
