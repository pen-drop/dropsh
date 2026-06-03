<?php

declare(strict_types=1);

use Drupal\user\RoleInterface;

user_role_grant_permissions(RoleInterface::ANONYMOUS_ID, ['access sdc components']);
user_role_grant_permissions(RoleInterface::AUTHENTICATED_ID, ['access sdc components']);

$components = \Drupal::service('plugin.manager.sdc')->getDefinitions();
echo 'SDC components available: ' . count($components) . PHP_EOL;
foreach (array_slice(array_keys($components), 0, 10) as $component_id) {
  echo '  component: ' . $component_id . PHP_EOL;
}

echo "Canvas setup complete\n";
