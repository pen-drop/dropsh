<?php

/**
 * @file
 * Multisite mapping for dropsh integration test fixture.
 *
 * Each subdomain hosts a separate Drupal site with its own database. The
 * default site (<project>.ddev.site) is the "plain" integration; the others
 * live at <site>.<project>.ddev.site.
 *
 * The DDEV project name is per-worktree (see `pnpm run init-worktree`), so the
 * host prefixes are derived from DDEV's `DDEV_SITENAME` env var instead of a
 * hardcoded `dropsh-test`. Falls back to `dropsh-test` when unset (e.g. outside
 * DDEV) so the mapping still resolves the historical hostnames.
 *
 * @see https://www.drupal.org/docs/8/multisite
 */

$ddev_project = getenv('DDEV_SITENAME') ?: 'dropsh-test';

foreach (['schemata', 'jsonapischema', 'canvas', 'db'] as $subsite) {
  $sites["$subsite.$ddev_project.ddev.site"] = $subsite;
}
