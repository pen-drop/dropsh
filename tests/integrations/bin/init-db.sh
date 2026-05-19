#!/usr/bin/env bash
# Provision the "db" (display_builder) integration site.
# - Subsite at https://db.dropsh-test.ddev.site
# - jsonapi + basic_auth + display_builder + ui_patterns + jsonapi_sdc
# - Stub for the upcoming display-builder plugin; structurally mirrors canvas.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="db.dropsh-test.ddev.site"
SITE_DIR="db"
DB_NAME="dropsh_db"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-db"

enable_modules "$URI" \
  basic_auth jsonapi jsonapi_resources \
  ui_patterns ui_patterns_library \
  display_builder jsonapi_sdc

make_jsonapi_writable "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php

echo "init-db done at https://${URI}"
