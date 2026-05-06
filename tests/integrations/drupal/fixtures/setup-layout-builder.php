<?php

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

// Enable Layout Builder on the default view display with per-node overrides.
\Drupal::service('entity_display.repository')
  ->getViewDisplay('node', $bundle, 'default')
  ->enableLayoutBuilder()
  ->setOverridable()
  ->save();

echo "Layout Builder enabled on {$bundle} default display (overridable)\n";
echo "Read layout via: GET /jsonapi/layout/resolve?path=/node/<nid>&_format=json\n";
echo "Write: blocked — LayoutSectionItemList::defaultAccess() returns forbidden() in core\n";
echo "Layout Builder setup complete\n";
