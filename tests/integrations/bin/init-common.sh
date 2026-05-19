#!/usr/bin/env bash
# Shared helpers for per-integration init scripts.
# Sourced from bin/init-*.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

# Wait for Drupal to be reachable on a given URI.
wait_for_url() {
  local url="$1"
  local tries=30
  while (( tries > 0 )); do
    if curl -s -k -o /dev/null -w "%{http_code}" "$url" | grep -qE "^(200|301|302|403)$"; then
      return 0
    fi
    sleep 1
    tries=$((tries - 1))
  done
  echo "URL never came up: $url" >&2
  return 1
}

# Create a database in the DDEV mariadb container (idempotent).
create_db() {
  local db_name="$1"
  ddev mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS \`${db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; GRANT ALL ON \`${db_name}\`.* TO 'db'@'%';" >/dev/null
}

# Install Drupal into a multisite directory.
#
# Args:
#   site_dir   relative path under web/sites/ (e.g. "schemata"; "default" for plain)
#   db_name    mariadb database name
#   uri        hostname for --uri (e.g. schemata.dropsh-test.ddev.site)
#   profile    install profile (standard|minimal)
#   site_name  human-readable site name
install_site() {
  local site_dir="$1"
  local db_name="$2"
  local uri="$3"
  local profile="$4"
  local site_name="$5"

  # Drupal's findSitePath() needs sites/<dir>/settings.php to exist before it
  # will route requests to that subsite. Seed an empty settings.php so drush
  # install can resolve the URI; drush then overwrites it with real config.
  ddev exec bash -c "
    set -e
    if [ -d /var/www/html/web/sites/${site_dir} ]; then
      chmod -R u+w /var/www/html/web/sites/${site_dir} 2>/dev/null || true
    fi
    rm -rf /var/www/html/web/sites/${site_dir}/settings.php /var/www/html/web/sites/${site_dir}/files /var/www/html/web/sites/${site_dir}/services.yml
    mkdir -p /var/www/html/web/sites/${site_dir}
    cp /var/www/html/web/sites/default/default.settings.php /var/www/html/web/sites/${site_dir}/settings.php
    chmod -R u+w /var/www/html/web/sites/${site_dir}
  "
  create_db "${db_name}"

  ddev drush -l "https://${uri}" site:install "${profile}" -y \
    --account-name=admin --account-pass=admin \
    "--site-name=${site_name}" \
    "--db-url=mysql://db:db@db:3306/${db_name}"
}

# Override the basic_auth provider so it applies to every route (not just the
# ones with _auth: [basic_auth]). Needed for routes like /schemata/* whose
# modules don't opt into basic_auth explicitly. No custom Drupal module
# required — just per-site container yaml.
enable_global_basic_auth() {
  local site_dir="$1"
  local uri="$2"
  local target="/var/www/html/web/sites/${site_dir}"

  ddev exec bash -lc "set -e; chmod -R u+w ${target}"
  ddev exec cp /var/www/html/sites-templates/services.yml "${target}/services.yml"
  # Idempotent append: only add the include line if it's not already there.
  ddev exec bash -lc "grep -q 'container_yamls.*services.yml' ${target}/settings.php || cat /var/www/html/sites-templates/settings-append.php >> ${target}/settings.php"

  ddev drush -l "https://${uri}" cr >/dev/null
}

# Enable modules on a specific multisite.
enable_modules() {
  local uri="$1"
  shift
  ddev drush -l "https://${uri}" en -y "$@"
}

# Make JSON:API writable for a site.
make_jsonapi_writable() {
  local uri="$1"
  ddev drush -l "https://${uri}" php:eval "\\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"
}

# Run a PHP fixture script against a site.
run_fixture() {
  local uri="$1"
  local script="$2"
  ddev drush -l "https://${uri}" php:script "$script"
}

# Capture stdout of a PHP fixture script.
capture_fixture() {
  local uri="$1"
  local script="$2"
  ddev drush -l "https://${uri}" php:script "$script"
}

# Print the canonical web URL DDEV announces for the project (http).
ddev_http_url() {
  ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])'
}
