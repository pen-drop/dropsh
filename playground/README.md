# Playground

Lokale Use-Case-Ordner fuer die aktuell laufende DDEV-Testinstanz.

Voraussetzung:

```bash
npm run drupal:up
cd playground
npm install
```

Use Cases:

- `content-basic/`: lesen, suchen und Inhalte anlegen per Basic Auth
- `login/`: OAuth 2.0 Authorization Code + PKCE ueber `drupal-cli login`

Beispiele:

```bash
cd playground
DRUPAL_CLI_CONFIG=content-basic/.drupal-cli.yml npx drupal-cli search node --bundle=article_test
```

```bash
cd playground
DRUPAL_CLI_CONFIG=login/.drupal-cli.yml npx drupal-cli login
```

Browser-Zugang zur Testinstanz:

- Frontend/Start: `https://drupal-cli-test-98be050f.ddev.site`
- Login: `https://drupal-cli-test-98be050f.ddev.site/user/login`
- Admin: `admin / admin`
- Tester: `tester / tester-pw`

Hinweis:

Fuer CLI-Configs nutzen die Beispiele standardmaessig `http://...ddev.site`, damit lokale TLS-/Zertifikatsthemen in Node das Testen nicht blockieren.
