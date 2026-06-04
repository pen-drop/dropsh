#!/usr/bin/env bash
# Provision the "db" (display_builder) integration site.
# - Subsite at https://db.dropsh-test.ddev.site
# - jsonapi + basic_auth + display_builder + display_builder_entity_view
# - ui_patterns + jsonapi_sdc
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
  display_builder display_builder_entity_view jsonapi_sdc

restore_services_yml "$URI" "$SITE_DIR"
make_jsonapi_writable "$URI"

run_fixture "$URI" fixtures/patch-display-builder-metadata-api.php
run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php
run_fixture "$URI" fixtures/setup-display-builder.php

echo "init-db done at https://${URI}"
