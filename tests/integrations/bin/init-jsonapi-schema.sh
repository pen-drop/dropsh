#!/usr/bin/env bash
# Provision the "jsonapischema" integration site.
# - Subsite at https://jsonapischema.dropsh-test.ddev.site
# - jsonapi + jsonapi_resources + jsonapi_schema + simple_oauth
#
# jsonapi_schema's schema routes (…/resource/schema) do NOT declare `_auth`, so
# Drupal core basic_auth (which is global: false) cannot authenticate them — an
# authenticated basic request is rejected with 403 (same limitation the schemata
# module has on its /schemata/* route). OAuth Bearer (global: true) authenticates
# those routes, so this site enables simple_oauth and tests default to the
# password grant.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="jsonapischema.dropsh-test.ddev.site"
SITE_DIR="jsonapischema"
DB_NAME="dropsh_jsonapi_schema"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-jsonapischema"

enable_modules "$URI" \
  basic_auth jsonapi jsonapi_resources jsonapi_schema \
  simple_oauth simple_oauth_password_grant consumers

make_jsonapi_writable "$URI"
setup_oauth_keys "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php
run_fixture "$URI" fixtures/setup-oauth.php

echo "init-jsonapi-schema done at https://${URI}"
