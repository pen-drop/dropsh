<?php

declare(strict_types=1);

$module_dir = DRUPAL_ROOT . '/modules/contrib/display_builder';
$routing_file = $module_dir . '/display_builder.routing.yml';
$controller_file = $module_dir . '/src/Controller/SchemaMetadataController.php';

if (!file_exists($routing_file)) {
  throw new RuntimeException("Display Builder routing file not found at {$routing_file}");
}

$routing = file_get_contents($routing_file);
if (!str_contains($routing, 'display_builder.api_schema_entity_view:')) {
  $routing .= <<<'YAML'

display_builder.api_schema_entity_view:
  path: '/api/display-builder/schema/entity-view/{entity_type}/{bundle}/{view_mode}'
  methods: [GET]
  defaults:
    _controller: '\Drupal\display_builder\Controller\SchemaMetadataController::entityView'
    view_mode: 'default'
  requirements:
    _permission: 'access content'

YAML;
  file_put_contents($routing_file, $routing);
  echo "Patched Display Builder schema metadata route\n";
}
else {
  echo "Display Builder schema metadata route already patched\n";
}

if (!file_exists($controller_file)) {
  $controller = <<<'PHP'
<?php

declare(strict_types=1);

namespace Drupal\display_builder\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\display_builder\ComponentLibraryDefinitionHelper;
use Drupal\display_builder\DisplayBuildableInterface;
use Symfony\Component\HttpFoundation\JsonResponse;

/**
 * Exposes Display Builder entity-view metadata for API clients.
 */
final class SchemaMetadataController extends ControllerBase {

  /**
   * Returns schema metadata for an entity view display.
   */
  public function entityView(string $entity_type, string $bundle, string $view_mode = 'default'): JsonResponse {
    $storage = $this->entityTypeManager()->getStorage('entity_view_display');
    $display = $storage->load("{$entity_type}.{$bundle}.{$view_mode}");

    if (!$display) {
      return new JsonResponse(['enabled' => FALSE]);
    }

    $profile_id = $display->getThirdPartySetting('display_builder', DisplayBuildableInterface::PROFILE_PROPERTY);
    if (!$profile_id) {
      return new JsonResponse(['enabled' => FALSE]);
    }

    $profile = $this->entityTypeManager()
      ->getStorage('display_builder_profile')
      ->load($profile_id);
    if (!$profile) {
      return new JsonResponse(['enabled' => FALSE]);
    }

    $override_field = $display->getThirdPartySetting('display_builder', DisplayBuildableInterface::OVERRIDE_FIELD_PROPERTY);
    $override_profile_id = $display->getThirdPartySetting('display_builder', DisplayBuildableInterface::OVERRIDE_PROFILE_PROPERTY);
    $sources = $display->getThirdPartySetting('display_builder', DisplayBuildableInterface::SOURCES_PROPERTY, []);

    return new JsonResponse([
      'enabled' => TRUE,
      'entity_type' => $entity_type,
      'bundle' => $bundle,
      'view_mode' => $view_mode,
      'profile' => [
        'id' => (string) $profile->id(),
        'label' => (string) $profile->label(),
      ],
      'override_field' => $override_field,
      'override_profile' => $override_profile_id ? [
        'id' => $override_profile_id,
        'label' => $this->profileLabel($override_profile_id),
      ] : NULL,
      'instance_id' => "entity_view__{$entity_type}__{$bundle}__{$view_mode}",
      'source_tree' => $sources,
      'allowed_components' => $this->allowedComponents($profile),
      'sources' => [
        [
          'id' => 'component',
          'label' => 'Component',
          'source_type' => 'component',
          'schema' => $this->componentSourceSchema(),
        ],
      ],
      'unsupported_sources' => [],
    ]);
  }

  /**
   * Builds the component list allowed by the profile's component library.
   */
  private function allowedComponents(object $profile): array {
    $configuration = $profile->getIslandConfiguration('component_library');
    $configuration += [
      'exclude' => [],
      'exclude_id' => '',
      'component_status' => [],
      'include_no_ui' => FALSE,
    ];

    $helper = new ComponentLibraryDefinitionHelper(
      \Drupal::service('plugin.manager.sdc'),
      \Drupal::service('plugin.manager.ui_patterns_source')
    );
    $definitions = $helper->getDefinitions($configuration);
    $components = [];

    foreach (array_keys($definitions['filtered']) as $component_id) {
      $component = \Drupal::service('plugin.manager.sdc')->find($component_id);
      $schema = $component->metadata->schema ?? [];
      $components[] = [
        'id' => $component_id,
        'source_id' => $component_id,
        'name' => $component->metadata->name ?? $component_id,
        'schema' => [
          'type' => 'object',
          'additionalProperties' => FALSE,
          'properties' => [
            'component_id' => [
              'type' => 'string',
              'const' => $component_id,
            ],
            'props' => $schema ?: [
              'type' => 'object',
              'additionalProperties' => TRUE,
            ],
            'slots' => [
              'type' => 'object',
              'additionalProperties' => TRUE,
            ],
          ],
          'required' => ['component_id'],
        ],
      ];
    }

    return $components;
  }

  /**
   * Returns the generic UI Patterns component source schema.
   */
  private function componentSourceSchema(): array {
    return [
      'type' => 'object',
      'additionalProperties' => FALSE,
      'properties' => [
        'source_id' => [
          'type' => 'string',
          'const' => 'component',
        ],
        'source' => [
          'type' => 'object',
          'additionalProperties' => FALSE,
          'properties' => [
            'component' => [
              'type' => 'object',
              'additionalProperties' => TRUE,
            ],
          ],
          'required' => ['component'],
        ],
      ],
      'required' => ['source_id', 'source'],
    ];
  }

  /**
   * Returns a profile label when available.
   */
  private function profileLabel(string $profile_id): string {
    $profile = $this->entityTypeManager()
      ->getStorage('display_builder_profile')
      ->load($profile_id);

    return $profile ? (string) $profile->label() : $profile_id;
  }

}
PHP;
  file_put_contents($controller_file, $controller);
  echo "Patched Display Builder schema metadata controller\n";
}
else {
  echo "Display Builder schema metadata controller already patched\n";
}

\Drupal::service('router.builder')->rebuild();
drupal_flush_all_caches();
echo "Display Builder metadata API patch complete\n";
