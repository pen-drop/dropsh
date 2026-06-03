#!/usr/bin/env bash
# Orchestrate the dropsh integration test fixture.
#
# Starts a single DDEV project (dropsh-test) that hosts four Drupal sites
# via the multisite feature; each site is an isolated integration scenario:
#
#   plain    — https://dropsh-test.ddev.site            (jsonapi + simple_oauth)
#   schemata — https://schemata.dropsh-test.ddev.site   (jsonapi + schemata)
#   canvas   — https://canvas.dropsh-test.ddev.site     (jsonapi + canvas)
#   db       — https://db.dropsh-test.ddev.site         (jsonapi + display_builder)
#
# Each site has its own database; each scenario is provisioned by its own
# bin/init-<name>.sh script. Coordinates (URLs, credentials) are static and
# baked into tests/integrations/helpers/config.ts — no .test-config.json
# handover.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BIN_DIR="$ROOT/tests/integrations/bin"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

ddev start
ddev composer install --no-interaction

# Lay down sites.php so drush -l <uri> can resolve subsites.
cp "${DRUPAL_DIR}/sites-templates/sites.php" "${DRUPAL_DIR}/web/sites/sites.php"

# Provision each integration site in turn.
bash "${BIN_DIR}/init-plain.sh"
bash "${BIN_DIR}/init-schemata.sh"
bash "${BIN_DIR}/init-canvas.sh"
bash "${BIN_DIR}/init-db.sh"

cat <<EOF

Multisite fixture ready:
  plain    https://dropsh-test.ddev.site
  schemata https://schemata.dropsh-test.ddev.site
  canvas   https://canvas.dropsh-test.ddev.site
  db       https://db.dropsh-test.ddev.site

Run: pnpm run test:integration
EOF
