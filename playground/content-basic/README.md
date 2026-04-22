# content-basic

Nutze diesen Ordner fuer klassische JSON:API-Aufrufe mit Basic Auth.

Beispiele:

```bash
cd playground
DRUPAL_CLI_CONFIG=content-basic/.drupal-cli.yml npx drupal-cli search node --bundle=article_test
```

```bash
cd playground
DRUPAL_CLI_CONFIG=content-basic/.drupal-cli.yml npx drupal-cli create node --bundle=article_test --data=@content-basic/create-article.json
```

```bash
cd playground
DRUPAL_CLI_CONFIG=content-basic/.drupal-cli.yml npx drupal-cli search node --bundle=article_test --filter=title:Playground Artikel
```
