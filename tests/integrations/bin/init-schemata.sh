#!/usr/bin/env bash
# Provision the "schemata" integration site.
# - Subsite at https://schemata.dropsh-test.ddev.site
# - jsonapi + basic_auth + schemata + schemata_json_schema
# - No simple_oauth (avoids the basic_auth-on-schemata-routes conflict).
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
  schemata schemata_json_schema

enable_global_basic_auth "$SITE_DIR" "$URI"
make_jsonapi_writable "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php

echo "init-schemata done at https://${URI}"
