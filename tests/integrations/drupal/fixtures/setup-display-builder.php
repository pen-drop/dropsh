<?php

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\node\Entity\NodeType;

$bundle = 'landing_page';
$type = NodeType::load($bundle);
if (!$type) {
  $type = NodeType::create(['type' => $bundle, 'name' => 'Landing Page']);
  $type->save();
  echo "Created content type {$bundle}\n";
} else {
  echo "Content type {$bundle} already exists\n";
}

// Add ui_patterns_source field 'field_display' to landing_page.
$field_name = 'field_display';
$storage = FieldStorageConfig::loadByName('node', $field_name);
if (!$storage) {
  $storage = FieldStorageConfig::create([
    'field_name' => $field_name,
    'entity_type' => 'node',
    'type' => 'ui_patterns_source',
    'cardinality' => 1,
  ]);
  $storage->save();
  echo "Created field storage {$field_name}\n";
}

$field = FieldConfig::loadByName('node', $bundle, $field_name);
if (!$field) {
  $field = FieldConfig::create([
    'field_storage' => $storage,
    'bundle' => $bundle,
    'label' => 'Display',
  ]);
  $field->save();
  echo "Attached {$field_name} to {$bundle}\n";
}

$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
echo "Fields on {$bundle}:\n";
foreach ($fields as $name => $def) {
  if (str_starts_with($name, 'field_')) {
    echo "  {$name} => " . $def->getType() . "\n";
  }
}

echo "Display Builder setup complete\n";
