<?php

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\node\Entity\NodeType;
use Drupal\paragraphs\Entity\ParagraphsType;

// --- Paragraph types ---

// 1. text_block: a simple text paragraph
$text_block = ParagraphsType::load('text_block');
if (!$text_block) {
  $text_block = ParagraphsType::create([
    'id' => 'text_block',
    'label' => 'Text block',
  ]);
  $text_block->save();
  echo "Created paragraph type: text_block\n";
}

// Add body field to text_block
if (!FieldStorageConfig::loadByName('paragraph', 'field_body')) {
  FieldStorageConfig::create([
    'field_name' => 'field_body',
    'entity_type' => 'paragraph',
    'type' => 'text_long',
    'cardinality' => 1,
  ])->save();
}
if (!FieldConfig::loadByName('paragraph', 'text_block', 'field_body')) {
  FieldConfig::create([
    'field_storage' => FieldStorageConfig::loadByName('paragraph', 'field_body'),
    'bundle' => 'text_block',
    'label' => 'Body',
  ])->save();
  echo "Added field_body to text_block\n";
}

// 2. hero: title + subtitle paragraph
$hero = ParagraphsType::load('hero');
if (!$hero) {
  $hero = ParagraphsType::create([
    'id' => 'hero',
    'label' => 'Hero',
  ]);
  $hero->save();
  echo "Created paragraph type: hero\n";
}

if (!FieldStorageConfig::loadByName('paragraph', 'field_title')) {
  FieldStorageConfig::create([
    'field_name' => 'field_title',
    'entity_type' => 'paragraph',
    'type' => 'string',
    'cardinality' => 1,
  ])->save();
}
if (!FieldConfig::loadByName('paragraph', 'hero', 'field_title')) {
  FieldConfig::create([
    'field_storage' => FieldStorageConfig::loadByName('paragraph', 'field_title'),
    'bundle' => 'hero',
    'label' => 'Title',
  ])->save();
  echo "Added field_title to hero\n";
}

if (!FieldStorageConfig::loadByName('paragraph', 'field_subtitle')) {
  FieldStorageConfig::create([
    'field_name' => 'field_subtitle',
    'entity_type' => 'paragraph',
    'type' => 'string',
    'cardinality' => 1,
  ])->save();
}
if (!FieldConfig::loadByName('paragraph', 'hero', 'field_subtitle')) {
  FieldConfig::create([
    'field_storage' => FieldStorageConfig::loadByName('paragraph', 'field_subtitle'),
    'bundle' => 'hero',
    'label' => 'Subtitle',
  ])->save();
  echo "Added field_subtitle to hero\n";
}

// --- Node type: landing_page with field_sections (paragraphs) ---

$bundle = 'landing_page';
$type = NodeType::load($bundle);
if (!$type) {
  $type = NodeType::create(['type' => $bundle, 'name' => 'Landing Page']);
  $type->save();
  echo "Created content type: {$bundle}\n";
}

// Paragraphs field: field_sections (unlimited cardinality, accepts hero + text_block)
if (!FieldStorageConfig::loadByName('node', 'field_sections')) {
  FieldStorageConfig::create([
    'field_name' => 'field_sections',
    'entity_type' => 'node',
    'type' => 'entity_reference_revisions',
    'cardinality' => -1,
    'settings' => ['target_type' => 'paragraph'],
  ])->save();
}
if (!FieldConfig::loadByName('node', $bundle, 'field_sections')) {
  FieldConfig::create([
    'field_storage' => FieldStorageConfig::loadByName('node', 'field_sections'),
    'bundle' => $bundle,
    'label' => 'Sections',
    'settings' => [
      'handler' => 'default:paragraph',
      'handler_settings' => [
        'target_bundles' => ['hero' => 'hero', 'text_block' => 'text_block'],
        'target_bundles_drag_drop' => [
          'hero' => ['enabled' => TRUE, 'weight' => 0],
          'text_block' => ['enabled' => TRUE, 'weight' => 1],
        ],
      ],
    ],
  ])->save();
  echo "Added field_sections (paragraphs) to {$bundle}\n";
}

$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
echo "Fields on {$bundle}:\n";
foreach ($fields as $name => $def) {
  if (str_starts_with($name, 'field_')) {
    echo "  {$name} => " . $def->getType() . "\n";
  }
}

echo "Paragraphs setup complete\n";
