
/**
 * dropsh integration fixture: load per-site service overrides.
 *
 * services.yml lives next to this settings.php and re-declares the
 * basic_auth provider as a global authentication provider so routes
 * without an explicit _auth option (e.g. /schemata/*) accept basic auth.
 */
$settings['container_yamls'][] = __DIR__ . '/services.yml';
