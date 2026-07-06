<?php

declare(strict_types=1);

use Drupal\display_builder\DisplayBuildableInterface;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\user\RoleInterface;

$entity_type = 'node';
$bundle = 'article';
$field_name = 'field_display_builder_override';

if (!FieldStorageConfig::loadByName($entity_type, $field_name)) {
  $field_storage = FieldStorageConfig::create([
    'field_name' => $field_name,
    'entity_type' => $entity_type,
    'type' => 'ui_patterns_source',
  ]);
  $field_storage->setTranslatable(TRUE);
  $field_storage->setCardinality(-1);
  $field_storage->save();
  echo "Created field storage {$field_name}\n";
}

if (!FieldConfig::loadByName($entity_type, $bundle, $field_name)) {
  FieldConfig::create([
    'field_name' => $field_name,
    'entity_type' => $entity_type,
    'bundle' => $bundle,
    'label' => 'Display Builder override',
  ])->save();
  echo "Created field {$field_name} on {$bundle}\n";
}

$display = \Drupal::entityTypeManager()
  ->getStorage('entity_view_display')
  ->load("{$entity_type}.{$bundle}.default");
if (!$display) {
  throw new RuntimeException("Missing entity view display {$entity_type}.{$bundle}.default");
}

$display
  ->setThirdPartySetting('display_builder', DisplayBuildableInterface::PROFILE_PROPERTY, 'default')
  ->setThirdPartySetting('display_builder', DisplayBuildableInterface::OVERRIDE_FIELD_PROPERTY, $field_name)
  ->setThirdPartySetting('display_builder', DisplayBuildableInterface::OVERRIDE_PROFILE_PROPERTY, 'default')
  ->setThirdPartySetting('display_builder', DisplayBuildableInterface::SOURCES_PROPERTY, [])
  ->save();
echo "Configured Display Builder on {$entity_type}.{$bundle}.default\n";

foreach ([RoleInterface::ANONYMOUS_ID, RoleInterface::AUTHENTICATED_ID] as $role_id) {
  user_role_grant_permissions($role_id, ['access sdc components']);
}

$role = \Drupal::entityTypeManager()->getStorage('user_role')->load('integration_editor');
if ($role && !$role->hasPermission('access sdc components')) {
  $role->grantPermission('access sdc components');
  $role->save();
}
if ($role && !$role->hasPermission('administer node display')) {
  $role->grantPermission('administer node display');
  $role->save();
}
if ($role && !$role->hasPermission('use display builder default')) {
  $role->grantPermission('use display builder default');
  $role->save();
}

echo "Display Builder setup complete\n";
