#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"
ddev delete -Oy || true
rm -f .test-config.json .ddev/config.local.yaml
