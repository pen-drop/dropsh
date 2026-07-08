#!/usr/bin/env bash
# Provision the "jsonapischema" integration site.
# - Subsite at https://jsonapischema.dropsh-test.ddev.site
# - jsonapi + jsonapi_resources + jsonapi_schema
#
# jsonapi_schema serves its schema routes under the JSON:API prefix
# (/jsonapi/<entity>/<bundle>/resource/schema), so Drupal core basic_auth —
# which JSON:API opts into — authenticates them just like every other dropsh
# request. No OAuth Bearer dance is needed (unlike the dead schemata module's
# custom /schemata/* route).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="jsonapischema.dropsh-test.ddev.site"
SITE_DIR="jsonapischema"
DB_NAME="dropsh_jsonapi_schema"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-jsonapischema"

enable_modules "$URI" \
  basic_auth jsonapi jsonapi_resources jsonapi_schema

make_jsonapi_writable "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php

echo "init-jsonapi-schema done at https://${URI}"
