<?php

/**
 * @file
 * Multisite mapping for dropsh integration test fixture.
 *
 * Each subdomain hosts a separate Drupal site with its own database.
 * The default site (dropsh-test.ddev.site) is the "plain" integration.
 *
 * @see https://www.drupal.org/docs/8/multisite
 */

$sites['schemata.dropsh-test.ddev.site'] = 'schemata';
$sites['jsonapischema.dropsh-test.ddev.site'] = 'jsonapischema';
$sites['canvas.dropsh-test.ddev.site'] = 'canvas';
$sites['db.dropsh-test.ddev.site'] = 'db';
