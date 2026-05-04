# Playground

Ein Ordner, alle Beispiele. Arbeitet gegen die lokale DDEV-Testinstanz
aus `npm run drupal:up` und zeigt die typischen Flows einmal durch.

## Setup

```bash
npm run drupal:up
cd playground
npm install
```

`drupal:up` schreibt die echte DDEV-URL nach
`tests/integrations/drupal/.test-config.json`. Falls dein lokaler Hostname
von `drupal-cli-test-98be050f.ddev.site` abweicht, passe die
`base_url` in `.drupal-cli.yml` und `.drupal-cli.oauth.yml` einmalig an:

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
DRUPAL_CLI_CONFIG=.drupal-cli.oauth.yml npx drupal-cli login
```

Die Fixture ist auf den Callback `http://localhost:7432/callback` ausgelegt
(`redirect_port: 7432` in `.drupal-cli.oauth.yml`).

Danach laufen beliebige andere Befehle mit derselben Config gegen das
Token:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.oauth.yml npx drupal-cli search node --bundle=article_test --limit=3
```

Alle weiteren Beispiele nutzen `.drupal-cli.yml` (Basic Auth), weil das ohne
Browser-Interaktion auskommt.

## 2. Schema: Catalog

Alle Targets auflisten, die über JSON:API erreichbar sind:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli schema
```

## 3. Schema: Per Target

Das JSON-Schema für ein konkretes `entity/bundle` holen. Das Ergebnis wird
unter `.drupal-cli/cache/schema/` gecacht — `--refresh` umgeht den Cache:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli schema node/article_test
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli schema node/article_test --refresh
```

Das Feld `x-drupal-cli-source` im Output zeigt, woher das Schema kommt:

- `schemata` — echtes JSON-Schema aus dem Drupal-Modul `schemata`
- `heuristic` — aus drei Beispiel-Instanzen abgeleitet (kein `required`)
- `heuristic-empty` — Bundle existiert, aber keine Instanzen vorhanden

Die Fixture aus `drupal:up` installiert kein `schemata`-Modul, Quelle
wird also `heuristic` sein. Für die `schemata`-Quelle gibt es die
Zusatz-Fixture `npm run drupal-schemata:up`.

`--for` steuert die Operation-Variante:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli schema node/article_test --for=create
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli schema node/article_test --for=update
```

## 4. Create

Legt einen Artikel an. Die UUID steht in der Antwort unter `data.id`:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli create node \
  --bundle=article_test \
  --data=@create-article.json
```

Die Payload (`create-article.json`) enthält `data.type` und Attribute —
die Client-Validierung prüft sie vor dem HTTP-Call gegen das gecachte Schema.

UUID in eine Shell-Variable übernehmen für die nächsten Schritte:

```bash
UUID=$(DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli create node \
  --bundle=article_test --data=@create-article.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
echo "$UUID"
```

## 5. Update

Update benötigt `data.id` in der Payload und das Target in der URL:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli update node/article_test/$UUID \
  --data='{"data":{"type":"node--article_test","id":"'$UUID'","attributes":{"title":"Aktualisierter Artikel"}}}'
```

Auch hier läuft vorher die Client-Validierung — mit `--for=update`-Variante
des Schemas, die `required`-Felder lockert.

## 6. Delete

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli delete node/article_test/$UUID
```

Antwort: `{"ok":true}`.

## 7. Validierung die fehlschlägt

`invalid-article.json` setzt `data.type: "node--falscher_bundle"`. Das Schema
erzwingt `data.type === "node--article_test"` als Konstante — die CLI bricht
mit Exit-Code 4 (`E_VALIDATION`) ab, bevor überhaupt ein HTTP-Call an Drupal
geht:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli create node \
  --bundle=article_test \
  --data=@invalid-article.json
# exit 4, error.code=E_VALIDATION
```

Wenn man die Client-Prüfung bewusst überspringen will (z.B. weil das
heuristische Schema bekannt zu streng ist), gibt es `--no-validate`:

```bash
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli create node \
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
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli schema > /dev/null

echo "create:"
UUID=$(DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli create node \
  --bundle=article_test --data=@create-article.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
echo "  $UUID"

echo "update:"
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli update node/article_test/$UUID \
  --data='{"data":{"type":"node--article_test","id":"'$UUID'","attributes":{"title":"Aktualisiert"}}}' \
  > /dev/null

echo "delete:"
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli delete node/article_test/$UUID

echo "validation fail (erwartet exit 4):"
DRUPAL_CLI_CONFIG=.drupal-cli.yml npx drupal-cli create node \
  --bundle=article_test --data=@invalid-article.json || echo "  exit=$?"
```

## Dateien in diesem Ordner

- `.drupal-cli.yml` — Basic-Auth-Config für die Beispiele 2–7
- `.drupal-cli.oauth.yml` — OAuth-Authcode-Config für Beispiel 1
- `create-article.json` — gültige Payload für `create`
- `invalid-article.json` — bewusst ungültige Payload (falscher `data.type`)
