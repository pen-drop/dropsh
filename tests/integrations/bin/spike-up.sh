#!/usr/bin/env bash
set -euo pipefail

# Usage: spike-up.sh [canvas|display-builder|layout-builder]
# Default: canvas (recommended — all three together have a compatibility issue)
MODE="${1:-canvas}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="dropsh-spike-${MODE}-${HASH}"

mkdir -p .ddev
printf 'name: %s\n' "$PROJECT_NAME" > .ddev/config.local.yaml

ddev start
# Use `update` so that packages added to composer.json but not yet in the lock
# file are resolved. This is safe for a spike environment.
ddev composer update --no-interaction

ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="dropsh spike (${MODE})"

# Enable base modules
ddev drush en -y basic_auth jsonapi

# Enable Layout Builder (core, needed by all modes)
ddev drush en -y layout_builder

ddev drush php:eval "\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"

case "$MODE" in
  canvas)
    echo "=== Canvas mode: enabling Canvas only ==="
    ddev drush en -y canvas || echo "WARNING: canvas module not found or failed"
    ddev drush php:script fixtures/setup-canvas.php
    ;;
  display-builder)
    echo "=== Display Builder mode: enabling Display Builder only (no Canvas) ==="
    ddev drush en -y ui_patterns display_builder ui_patterns_field display_builder_entity_view || echo "WARNING: display_builder module not found or failed"
    ddev drush php:script fixtures/setup-display-builder.php
    ;;
  layout-builder)
    echo "=== Layout Builder mode: Layout Builder core + jsonapi_frontend_layout for read access ==="
    ddev drush en -y jsonapi_frontend jsonapi_frontend_layout || echo "WARNING: jsonapi_frontend_layout not found or failed"
    ddev drush php:script fixtures/setup-layout-builder.php
    ;;
  all)
    echo "WARNING: Installing Canvas + Display Builder together is known to produce a PHP TypeError."
    echo "         Use mode 'canvas' or 'display-builder' for clean isolated testing."
    ddev drush en -y canvas || echo "WARNING: canvas module not found or failed"
    ddev drush en -y ui_patterns display_builder || echo "WARNING: display_builder module not found or failed"
    ddev drush php:script fixtures/setup-canvas.php
    ddev drush php:script fixtures/setup-display-builder.php
    ;;
  *)
    echo "Unknown mode: $MODE. Use: canvas | display-builder | layout-builder | all"
    exit 1
    ;;
esac

URL="$(ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])')"

cat > .spike-config.json <<EOF
{
  "url": "${URL}",
  "basic": { "user": "admin", "pass": "admin" }
}
EOF

echo ""
echo "Spike Drupal (${MODE}) is up at ${URL}"
echo "Config written to tests/integrations/drupal/.spike-config.json"
echo "Run: node --import tsx/esm tests/integrations/explore/<script>.ts"
