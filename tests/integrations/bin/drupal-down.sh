#!/usr/bin/env bash
# Tear down the dropsh integration test fixture.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"
ddev delete -Oy || true
rm -f .test-config.json .ddev/config.local.yaml .plain-oauth.json
rm -rf web/sites/sites.php web/sites/schemata web/sites/canvas web/sites/db
