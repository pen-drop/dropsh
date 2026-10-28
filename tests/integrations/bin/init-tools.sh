#!/usr/bin/env bash
# Provision the "tools" integration site.
# - Subsite at https://tools.dropsh-test.ddev.site
# - tool + tool_belt + mcp_server + mcp_server_tool_bridge + mcp_server_oauth
#
# A stock mcp_server route accepts cookie auth only; mcp_server_oauth adds the
# oauth2 provider, so dropsh reaches /mcp with an OAuth Bearer token. Tests
# default to the password grant; basic auth is expected to be rejected.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/init-common.sh"

URI="tools.dropsh-test.ddev.site"
SITE_DIR="tools"
DB_NAME="dropsh_tools"

cd "$DRUPAL_DIR"

install_site "$SITE_DIR" "$DB_NAME" "$URI" "standard" "dropsh-tools"

enable_modules "$URI" \
  basic_auth jsonapi \
  simple_oauth simple_oauth_password_grant consumers
enable_modules "$URI" \
  simple_oauth_21 \
  tool tool_belt tool_belt_content \
  mcp_server mcp_server_tool_bridge mcp_server_oauth

make_jsonapi_writable "$URI"
setup_oauth_keys "$URI"

run_fixture "$URI" fixtures/setup-content-type.php
run_fixture "$URI" fixtures/setup-users.php
run_fixture "$URI" fixtures/setup-oauth.php
run_fixture "$URI" fixtures/setup-tools.php

echo "init-tools done at https://${URI}"
