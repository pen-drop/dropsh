# Playground

Ein Ordner, alle Beispiele. Arbeitet gegen die lokale DDEV-Testinstanz
aus `npm run drupal:up` und zeigt die typischen Flows einmal durch.

## Setup

```bash
npm run drupal:up
npm run build           # Haupt-Package compilieren
npm run build:plugins   # Plugins compilieren
cd playground
npm install
```

`drupal:up` schreibt die echte DDEV-URL nach
`tests/integrations/drupal/.test-config.json`. Falls dein lokaler Hostname
von `drupal-cli-test-schemata-5fdcffda.ddev.site` abweicht, passe die
`base_url` in `drupal-cli.config.js` und `drupal-cli.oauth.config.js` einmalig an:

```bash
cat ../tests/integrations/drupal/.test-config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])"
```

Zugangsdaten (alle aus der Fixture):

- Admin: `admin / admin`
- Tester: `tester / tester-pw`
- OAuth Consumer für `login`: `tests-authcode`

Alle Kommandos unten werden aus dem `playground/`-Ordner ausgeführt.

## 1. Login (OAuth 2.0 Authorization Code + PKCE)

Startet den Browser-Flow, speichert das Token für spätere Aufrufe mit
derselben Config ab. Interaktiv.

```bash
npx drupal-cli --config drupal-cli.oauth.config.js login
```

Die Fixture ist auf den Callback `http://localhost:7432/callback` ausgelegt
(`redirect_port: 7432` in `drupal-cli.oauth.config.js`).

Danach laufen beliebige andere Befehle mit derselben Config gegen das
Token:

```bash
npx drupal-cli --config drupal-cli.oauth.config.js search node --bundle=article_test --limit=3
```

Alle weiteren Beispiele nutzen `drupal-cli.config.js` (Basic Auth), weil das ohne
Browser-Interaktion auskommt.

## 2. Schema: Catalog

Alle Targets auflisten, die über JSON:API erreichbar sind:

```bash
npx drupal-cli --config drupal-cli.config.js schema
```

## 3. Schema: Per Target

Das JSON-Schema für ein konkretes `entity/bundle` holen. Das Ergebnis wird
unter `.drupal-cli/cache/schema/` gecacht — `--refresh` umgeht den Cache:

```bash
npx drupal-cli --config drupal-cli.config.js schema node/article_test
npx drupal-cli --config drupal-cli.config.js schema node/article_test --refresh
```

Das Feld `x-drupal-cli-source` im Output zeigt, woher das Schema kommt:

- `schemata` — echtes JSON-Schema aus dem Drupal-Modul `schemata`
- `heuristic` — aus drei Beispiel-Instanzen abgeleitet (kein `required`)
- `heuristic-empty` — Bundle existiert, aber keine Instanzen vorhanden

Die Fixture aus `drupal:up` installiert das `schemata`-Modul — die Quelle
wird also `schemata` sein (bereitgestellt durch das `schemataPlugin()`
in der Config).

`--for` steuert die Operation-Variante:

```bash
npx drupal-cli --config drupal-cli.config.js schema node/article_test --for=create
npx drupal-cli --config drupal-cli.config.js schema node/article_test --for=update
```

## 4. Create

Legt einen Artikel an. Die UUID steht in der Antwort unter `data.id`:

```bash
npx drupal-cli --config drupal-cli.config.js create node \
  --bundle=article_test \
  --data=@create-article.json
```

Die Payload (`create-article.json`) enthält `data.type` und Attribute —
die Client-Validierung prüft sie vor dem HTTP-Call gegen das gecachte Schema.

UUID in eine Shell-Variable übernehmen für die nächsten Schritte:

```bash
UUID=$(npx drupal-cli --config drupal-cli.config.js create node \
  --bundle=article_test --data=@create-article.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
echo "$UUID"
```

## 5. Update

Update benötigt `data.id` in der Payload und das Target in der URL:

```bash
npx drupal-cli --config drupal-cli.config.js update node/article_test/$UUID \
  --data='{"data":{"type":"node--article_test","id":"'$UUID'","attributes":{"title":"Aktualisierter Artikel"}}}'
```

Auch hier läuft vorher die Client-Validierung — mit `--for=update`-Variante
des Schemas, die `required`-Felder lockert.

## 6. Delete

```bash
npx drupal-cli --config drupal-cli.config.js delete node/article_test/$UUID
```

Antwort: `{"ok":true}`.

## 7. Validierung die fehlschlägt

`invalid-article.json` setzt `data.type: "node--falscher_bundle"`. Das Schema
erzwingt `data.type === "node--article_test"` als Konstante — die CLI bricht
mit Exit-Code 4 (`E_VALIDATION`) ab, bevor überhaupt ein HTTP-Call an Drupal
geht:

```bash
npx drupal-cli --config drupal-cli.config.js create node \
  --bundle=article_test \
  --data=@invalid-article.json
# exit 4, error.code=E_VALIDATION
```

Wenn man die Client-Prüfung bewusst überspringen will (z.B. weil das
heuristische Schema bekannt zu streng ist), gibt es `--no-validate`:

```bash
npx drupal-cli --config drupal-cli.config.js create node \
  --bundle=article_test \
  --data=@invalid-article.json \
  --no-validate
# jetzt lehnt Drupal selbst serverseitig ab (exit 5, E_HTTP)
```

## Kompletter Durchlauf als Skript

```bash
set -e
cd playground

echo "catalog:"
npx drupal-cli --config drupal-cli.config.js schema > /dev/null

echo "create:"
UUID=$(npx drupal-cli --config drupal-cli.config.js create node \
  --bundle=article_test --data=@create-article.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
echo "  $UUID"

echo "update:"
npx drupal-cli --config drupal-cli.config.js update node/article_test/$UUID \
  --data='{"data":{"type":"node--article_test","id":"'$UUID'","attributes":{"title":"Aktualisiert"}}}' \
  > /dev/null

echo "delete:"
npx drupal-cli --config drupal-cli.config.js delete node/article_test/$UUID

echo "validation fail (erwartet exit 4):"
npx drupal-cli --config drupal-cli.config.js create node \
  --bundle=article_test --data=@invalid-article.json || echo "  exit=$?"
```

## Dateien in diesem Ordner

- `drupal-cli.config.js` — Basic-Auth-Config mit `schemataPlugin` für die Beispiele 2–7
- `drupal-cli.oauth.config.js` — OAuth-Authcode-Config mit `schemataPlugin` + `oauth2Plugin` für Beispiel 1
- `create-article.json` — gültige Payload für `create`
- `invalid-article.json` — bewusst ungültige Payload (falscher `data.type`)
