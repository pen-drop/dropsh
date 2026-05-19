#!/usr/bin/env bash
# Provision the "canvas" integration site.
# - Subsite at https://canvas.dropsh-test.ddev.site
# - jsonapi + basic_auth + canvas + jsonapi_sdc (Single Directory Components)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="canvas.dropsh-test.ddev.site"
SITE_DIR="canvas"
DB_NAME="dropsh_canvas"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-canvas"

enable_modules "$URI" \
  basic_auth jsonapi jsonapi_resources \
  canvas jsonapi_sdc

enable_global_basic_auth "$SITE_DIR" "$URI"
make_jsonapi_writable "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-canvas.php
run_fixture "$URI" fixtures/setup-users.php

echo "init-canvas done at https://${URI}"
