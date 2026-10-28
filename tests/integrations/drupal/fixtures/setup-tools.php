<?php

/**
 * @file
 * Exposes one Tool API tool over mcp_server for the "tools" integration site.
 *
 * Grants `access mcp server` to the integration_editor role (the role the
 * OAuth scope maps to) and creates an McpToolConfig for Tool Belt's
 * entity_create tool. The bridge publishes it as `tool_api__entity_create`.
 */

use Drupal\user\Entity\Role;

$role = Role::load('integration_editor');
if (!$role->hasPermission('access mcp server')) {
  $role->grantPermission('access mcp server');
  $role->save();
  echo "Granted 'access mcp server' to integration_editor\n";
}

$storage = \Drupal::entityTypeManager()->getStorage('mcp_tool_config');
$config = $storage->load('entity_create') ?? $storage->create([
  'id' => 'entity_create',
  'tool_id' => 'tool_belt:entity_create',
]);
$config->set('status', TRUE);
$config->save();
echo "MCP tool config entity_create ready\n";
