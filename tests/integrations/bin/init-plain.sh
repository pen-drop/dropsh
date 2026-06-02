#!/usr/bin/env bash
# Provision the "plain" integration site.
# - Default Drupal site at https://dropsh-test.ddev.site
# - jsonapi + basic_auth + simple_oauth (for OAuth and CRUD/auth tests)
# - No schemata, no canvas, no display_builder.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="dropsh-test.ddev.site"
SITE_DIR="default"
DB_NAME="db"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-plain"

enable_modules "$URI" \
  basic_auth jsonapi jsonapi_resources \
  simple_oauth simple_oauth_password_grant consumers

restore_services_yml "$URI" "$SITE_DIR"
make_jsonapi_writable "$URI"
setup_oauth_keys "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php
run_fixture "$URI" fixtures/setup-oauth.php

echo "init-plain done at https://${URI}"
