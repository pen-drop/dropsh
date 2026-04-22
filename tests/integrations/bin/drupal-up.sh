#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="drupal-cli-test-${HASH}"

mkdir -p .ddev
printf 'name: %s\n' "$PROJECT_NAME" > .ddev/config.local.yaml

ddev start
ddev composer install --no-interaction

ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="drupal-cli integration"

ddev drush en -y basic_auth jsonapi simple_oauth simple_oauth_password_grant consumers
ddev drush php:eval "\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"

KEYDIR="/var/www/html/keys"
ddev exec bash -lc "mkdir -p '$KEYDIR' && openssl genrsa -out '$KEYDIR/private.key' 2048 && openssl rsa -in '$KEYDIR/private.key' -pubout -out '$KEYDIR/public.key' && chmod 600 '$KEYDIR/private.key' '$KEYDIR/public.key'"
ddev drush config:set -y simple_oauth.settings public_key "$KEYDIR/public.key"
ddev drush config:set -y simple_oauth.settings private_key "$KEYDIR/private.key"

ddev drush php:script fixtures/setup-content-type.php
ddev drush php:script fixtures/setup-users.php
OAUTH_OUTPUT="$(ddev drush php:script fixtures/setup-oauth.php)"

OAUTH_JSON="$(printf '%s\n' "$OAUTH_OUTPUT" | grep '^CONSUMER_JSON:' | head -1 | sed 's/^CONSUMER_JSON://')"
if [ -z "$OAUTH_JSON" ]; then
  echo "ERROR: setup-oauth.php did not print CONSUMER_JSON line" >&2
  exit 1
fi

URL="$(ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])')"

cat > .test-config.json <<EOF
{
  "url": "${URL}",
  "basic": { "user": "tester", "pass": "tester-pw" },
  "oauth2": $(printf '%s' "$OAUTH_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
data["user"] = "tester"
data["pass"] = "tester-pw"
print(json.dumps(data, indent=2))
')
}
EOF

echo
echo "Drupal is up at ${URL}"
echo "Handover written to tests/integrations/drupal/.test-config.json"
echo "Run: npm run test:integration"
