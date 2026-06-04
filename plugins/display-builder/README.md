# Display Builder DropSH Plugin

Extends JSON:API operation schemas for entity view displays managed by Display Builder.

## Drupal Requirements

Enable these Drupal modules on the target site:

- `display_builder`
- `display_builder_entity_view`
- `jsonapi_sdc`

## Metadata Sources

The plugin reads Display Builder metadata from standard JSON:API config resources:

```http
GET /jsonapi/entity_view_display/entity_view_display?filter[drupal_internal__id]={entity_type}.{bundle}.{view_mode}
GET /jsonapi/display_builder_profile/display_builder_profile?filter[drupal_internal__id]={profile_id}
```

The factory requests the `default` view mode while building operation schemas. Component metadata
comes from `jsonapi_sdc`; Display Builder profile `component_library` settings are emitted as
schema metadata so clients can derive the configured component selection without a patched endpoint.
