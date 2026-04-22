<?php

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\node\Entity\NodeType;

$bundle = 'article_test';

$type = NodeType::load($bundle);
if (!$type) {
  $type = NodeType::create(['type' => $bundle, 'name' => 'Article Test']);
  $type->save();
  node_add_body_field($type);
  echo "Created content type {$bundle}\n";
} else {
  echo "Content type {$bundle} already exists\n";
}

function ensure_field(string $entity_type, string $bundle, string $field_name, string $type, array $config_overrides = []): void {
  if (!FieldStorageConfig::loadByName($entity_type, $field_name)) {
    FieldStorageConfig::create([
      'field_name' => $field_name,
      'entity_type' => $entity_type,
      'type' => $type,
    ])->save();
    echo "Created field storage {$field_name}\n";
  }

  if (!FieldConfig::loadByName($entity_type, $bundle, $field_name)) {
    FieldConfig::create(array_merge([
      'field_name' => $field_name,
      'entity_type' => $entity_type,
      'bundle' => $bundle,
      'label' => $field_name,
    ], $config_overrides))->save();
    echo "Created field {$field_name} on {$bundle}\n";
  }
}

ensure_field('node', $bundle, 'field_test_text', 'string', ['label' => 'Test Text']);
ensure_field('node', $bundle, 'field_image', 'image', ['label' => 'Image']);

echo "Content type setup complete\n";
