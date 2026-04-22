#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

if [ -f .ddev/config.local.yaml ]; then
  ddev stop --unlist --remove-data --omit-snapshot || true
fi

rm -f .test-config.json .ddev/config.local.yaml
echo "Drupal stopped and removed"
