<?php

use Drupal\node\Entity\NodeType;

$existing = array_keys(\Drupal::entityTypeManager()->getStorage('node_type')->loadMultiple());
echo "Existing node bundles after Display Builder install: " . implode(', ', $existing) . "\n";

$bundle = 'landing_page';
$type = NodeType::load($bundle);
if (!$type) {
  echo "Note: {$bundle} bundle not auto-created — creating manually\n";
  $type = NodeType::create(['type' => $bundle, 'name' => 'Landing Page']);
  $type->save();
  echo "Created content type {$bundle}\n";
} else {
  echo "Content type {$bundle} exists (created by Display Builder module)\n";
}

$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
foreach ($fields as $name => $def) {
  echo "  field: {$name} type: " . $def->getType() . "\n";
}

echo "Display Builder setup complete\n";
