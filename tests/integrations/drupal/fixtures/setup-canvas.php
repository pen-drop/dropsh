<?php

use Drupal\node\Entity\NodeType;

// Canvas module may auto-create its page bundle on install.
// Detect and report the actual bundle name.
$existing = array_keys(\Drupal::entityTypeManager()->getStorage('node_type')->loadMultiple());
echo "Existing node bundles after Canvas install: " . implode(', ', $existing) . "\n";

$bundle = 'canvas_page';
$type = NodeType::load($bundle);
if (!$type) {
  echo "Note: canvas_page bundle not auto-created — creating manually\n";
  $type = NodeType::create(['type' => $bundle, 'name' => 'Canvas Page']);
  $type->save();
  echo "Created content type {$bundle}\n";
} else {
  echo "Content type {$bundle} exists (created by Canvas module)\n";
}

// List all fields so exploration scripts know what to target.
$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
foreach ($fields as $name => $def) {
  echo "  field: {$name} type: " . $def->getType() . "\n";
}

echo "Canvas setup complete\n";
