#!/usr/bin/env bash
# Shared helpers for per-integration init scripts.
# Sourced from bin/init-*.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

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
    rm -rf /var/www/html/web/sites/${site_dir}/settings.php /var/www/html/web/sites/${site_dir}/files
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

# Generate (once) shared RSA keys and point the site's simple_oauth settings
# at them. Keys live outside the docroot at /var/www/html/keys.
setup_oauth_keys() {
  local uri="$1"
  local keydir="/var/www/html/keys"
  ddev exec bash -lc "mkdir -p '$keydir' && [ -f '$keydir/private.key' ] || (openssl genrsa -out '$keydir/private.key' 2048 && openssl rsa -in '$keydir/private.key' -pubout -out '$keydir/public.key' && chmod 600 '$keydir/private.key' '$keydir/public.key')"
  ddev drush -l "https://${uri}" config:set -y simple_oauth.settings public_key "$keydir/public.key"
  ddev drush -l "https://${uri}" config:set -y simple_oauth.settings private_key "$keydir/private.key"
}

# Run a PHP fixture script against a site.
run_fixture() {
  local uri="$1"
  local script="$2"
  ddev drush -l "https://${uri}" php:script "$script"
}
