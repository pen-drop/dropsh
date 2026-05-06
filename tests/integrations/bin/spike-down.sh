#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

ddev delete -O -y
rm -f .ddev/config.local.yaml .spike-config.json
echo "Spike DDEV project removed"
