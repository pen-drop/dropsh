# login

Nutze diesen Ordner fuer den OAuth-Login-Flow ueber Authorization Code + PKCE.

Der DDEV-Fixture-Consumer ist auf diese Redirect-URL ausgelegt:

- `http://localhost:7432/callback`

Login starten:

```bash
cd playground
DRUPAL_CLI_CONFIG=login/.drupal-cli.yml npx drupal-cli login
```

Danach kannst du mit derselben Config normale Befehle gegen das gespeicherte Token ausfuehren:

```bash
cd playground
DRUPAL_CLI_CONFIG=login/.drupal-cli.yml npx drupal-cli search node --bundle=article_test
```

Falls du lokal lieber per HTTPS testen willst:

```bash
cd playground
NODE_TLS_REJECT_UNAUTHORIZED=0 DRUPAL_CLI_CONFIG=login/.drupal-cli.yml npx drupal-cli login
```
