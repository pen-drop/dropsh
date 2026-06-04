# Display Builder DropSH Plugin

Extends JSON:API operation schemas for entity view displays managed by Display Builder.

## Drupal Requirements

Enable these Drupal modules on the target site:

- `display_builder`
- `display_builder_entity_view`
- `jsonapi_sdc`

## Metadata Endpoint

The plugin reads Display Builder metadata from:

```http
GET /api/display-builder/schema/entity-view/{entity_type}/{bundle}/{view_mode}
```

The factory requests the `default` view mode while building operation schemas.
