#!/usr/bin/env bash
# Provision the "schemata" integration site.
# - Subsite at https://schemata.dropsh-test.ddev.site
# - jsonapi + schemata + simple_oauth (for OAuth Bearer auth on /schemata/*)
#
# Schemata's custom /schemata/<entity>/<bundle> route does not set _auth, so
# Drupal core basic_auth (which is global: false) is rejected on that route.
# Using OAuth Bearer (global: true) is the cleanest way to authenticate
# against /schemata/* without patching modules or overriding services.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="schemata.dropsh-test.ddev.site"
SITE_DIR="schemata"
DB_NAME="dropsh_schemata"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-schemata"

enable_modules "$URI" \
  basic_auth jsonapi jsonapi_resources \
  simple_oauth simple_oauth_password_grant consumers \
  schemata schemata_json_schema

make_jsonapi_writable "$URI"
setup_oauth_keys "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php
run_fixture "$URI" fixtures/setup-oauth.php

echo "init-schemata done at https://${URI}"
