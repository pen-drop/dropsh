#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="dropsh-spike-${HASH}"

mkdir -p .ddev
printf 'name: %s\n' "$PROJECT_NAME" > .ddev/config.local.yaml

ddev start
ddev composer install --no-interaction

ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="dropsh spike"

# Enable base modules
ddev drush en -y basic_auth jsonapi

# Enable Layout Builder (core)
ddev drush en -y layout_builder

# Enable Canvas
ddev drush en -y canvas || echo "WARNING: canvas module not found or failed"

# Enable Display Builder and its dependency UI Patterns
ddev drush en -y ui_patterns display_builder || echo "WARNING: display_builder module not found or failed"

ddev drush php:eval "\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"

ddev drush php:script fixtures/setup-canvas.php
ddev drush php:script fixtures/setup-display-builder.php

URL="$(ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])')"

cat > .spike-config.json <<EOF
{
  "url": "${URL}",
  "basic": { "user": "admin", "pass": "admin" }
}
EOF

echo ""
echo "Spike Drupal is up at ${URL}"
echo "Config written to tests/integrations/drupal/.spike-config.json"
echo "Run: node --import tsx/esm tests/integrations/explore/<script>.ts"
